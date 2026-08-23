#!/usr/bin/env python3
"""
============================================
DVC AI — TELEGRAM BOT WORKER
Runs inside GitHub Actions (24/7, FREE)
promode × @dvc 2026
============================================
This script is executed by GitHub Actions every 2 minutes.
It polls Telegram for new commands and processes them.
No local terminal needed — fully serverless!
"""

import json
import base64
import os
import time
import requests
from datetime import datetime, timezone

# ============ CONFIG (from GitHub Secrets) ============
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')

GITHUB_USER = 'donrich99'
GITHUB_REPO = 'dvcaichat'
GITHUB_BRANCH = 'main'

GITHUB_API = f'https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}'
GITHUB_STATUS_URL = f'{GITHUB_API}/contents/status.json'
GITHUB_USERS_URL = f'{GITHUB_API}/contents/users.json'
GITHUB_STATE_URL = f'{GITHUB_API}/contents/bot/bot_state.json'

LIVE_URL = f'https://{GITHUB_USER}.github.io/{GITHUB_REPO}/'

TG_API = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}'

# ============ STATE FILE HELPERS ============
def get_local_state():
    """Read local state file (cached between runs via git)."""
    try:
        with open('bot/bot_state.json', 'r') as f:
            return json.load(f)
    except:
        return {'last_update_id': 0}


def save_local_state(state):
    """Save state locally AND push to GitHub for persistence."""
    try:
        with open('bot/bot_state.json', 'w') as f:
            json.dump(state, f, indent=2)
        # Push to GitHub so next run picks up where we left off
        update_github_file(GITHUB_STATE_URL, state, "bot: update state")
    except Exception as e:
        print(f'State save error: {e}')


# ============ GITHUB API HELPERS ============
def gh_headers():
    return {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Content-Type': 'application/json',
        'User-Agent': 'DVC-AI-Bot'
    }


def gh_get_file(url):
    """Get file from GitHub API."""
    try:
        r = requests.get(url, headers=gh_headers(), timeout=15)
        if r.status_code == 200:
            data = r.json()
            content = base64.b64decode(data.get('content', '')).decode()
            return {
                'sha': data.get('sha'),
                'content': content,
                'exists': True
            }
        return {'sha': None, 'content': None, 'exists': False}
    except Exception as e:
        print(f'GitHub read error: {e}')
        return {'sha': None, 'content': None, 'exists': False}


def update_github_file(url, content_dict, message):
    """Update a file on GitHub."""
    file_info = gh_get_file(url)
    content_str = json.dumps(content_dict, indent=2)
    content_b64 = base64.b64encode(content_str.encode()).decode()

    payload = {
        'message': message,
        'content': content_b64,
        'branch': GITHUB_BRANCH
    }
    if file_info['exists'] and file_info['sha']:
        payload['sha'] = file_info['sha']

    try:
        r = requests.put(url, headers=gh_headers(), json=payload, timeout=15)
        if r.status_code in [200, 201]:
            return True
        print(f'GitHub update error {r.status_code}: {r.text[:200]}')
        return False
    except Exception as e:
        print(f'GitHub update exception: {e}')
        return False


# ============ TELEGRAM API ============
def send_msg(text):
    """Send a Telegram message."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print('Missing Telegram config')
        return False
    try:
        r = requests.post(f'{TG_API}/sendMessage', json={
            'chat_id': TELEGRAM_CHAT_ID,
            'text': text,
            'parse_mode': 'HTML'
        }, timeout=10)
        return r.status_code == 200
    except Exception as e:
        print(f'TG error: {e}')
        return False


def get_updates(offset=None):
    """Poll Telegram for new updates."""
    params = {'timeout': 1}  # Short poll since Actions has limited time
    if offset:
        params['offset'] = offset + 1
    try:
        r = requests.get(f'{TG_API}/getUpdates', params=params, timeout=10)
        if r.status_code == 200:
            return r.json().get('result', [])
        print(f'getUpdates HTTP {r.status_code}: {r.text[:150]}')
        return []
    except Exception as e:
        print(f'getUpdates exception: {e}')
        return []


# ============ STATUS OPERATIONS ============
def set_server_status(new_status):
    """Turn server ON or OFF by updating status.json on GitHub."""
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    success = update_github_file(GITHUB_STATUS_URL, {
        'status': new_status,
        'last_updated': timestamp,
        'updated_by': '@dvc via Telegram (GitHub Actions)'
    }, f'toggle: server {new_status}')

    emoji = '🟢' if new_status == 'on' else '🔴'
    state_word = 'ONLINE' if new_status == 'on' else 'OFFLINE'
    action = 'can now access' if new_status == 'on' else 'will see offline page when they visit'

    if success:
        msg = (
            f'{emoji} <b>DVC AI — SERVER IS NOW {state_word}</b>\n\n'
            f'✅ Status: <b>{new_status.upper()}</b>\n'
            f'🌐 URL: {LIVE_URL}\n\n'
            f'<i>Users {action}.</i>\n'
            f'⏱️ Changes propagate within ~30-60s.'
        )
    else:
        msg = f'❌ Failed to turn server {"ON" if new_status == "on" else "OFF"}. Try again.'

    send_msg(msg)
    return success


# ============ USER OPERATIONS ============
def get_users_data():
    file_info = gh_get_file(GITHUB_USERS_URL)
    if file_info['exists'] and file_info['content']:
        try:
            return json.loads(file_info['content'])
        except:
            pass
    return {'users': [], 'total': 0, 'last_updated': '', 'updated_by': ''}


def save_users_data(data):
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    data['last_updated'] = timestamp
    data['total'] = len(data.get('users', []))
    data['updated_by'] = '@dvc via Telegram Bot'
    return update_github_file(GITHUB_USERS_URL, data, 'update users.json')


def find_user(users, target):
    """Find user by index (#N) or ID (DVC-XXXXXX)."""
    # Try by number first
    try:
        idx = int(target) - 1
        if 0 <= idx < len(users):
            return users[idx]
    except ValueError:
        pass

    # Try by ID
    target_upper = target.strip().upper()
    for u in users:
        if u.get('id', '').upper() == target_upper:
            return u

    return None


# ============ COMMAND HANDLERS ============
def cmd_on():
    set_server_status('on')


def cmd_off():
    set_server_status('off')


def cmd_status():
    status = 'unknown'
    try:
        file_info = gh_get_file(GITHUB_STATUS_URL)
        if file_info['content']:
            status = json.loads(file_info['content']).get('status', 'unknown')
    except:
        pass

    users_data = get_users_data()
    users = users_data.get('users', [])
    total = len(users)
    active = len([u for u in users if not u.get('blocked', False)])
    blocked = len([u for u in users if u.get('blocked', False)])

    emoji = '🟢' if status == 'on' else '🔴' if status == 'off' else '⚠️'
    state_word = 'ONLINE' if status == 'on' else 'OFFLINE' if status == 'off' else 'UNKNOWN'

    msg = (
        f'{emoji} <b>DVC AI — STATUS</b>\n\n'
        f'📊 Server: <b>{state_word}</b>\n'
        f'🌐 URL: {LIVE_URL}\n\n'
        f'👥 <b>Users:</b>\n'
        f'   • Total: {total}\n'
        f'   • Active: {active}\n'
        f'   • Blocked: {blocked}\n\n'
        f'<i>Last updated: just now</i>'
    )
    send_msg(msg)


def cmd_users():
    users_data = get_users_data()
    users = users_data.get('users', [])

    if not users:
        send_msg('👥 No users yet. Waiting for the first visitor...')
        return

    lines = [f'👥 <b>ALL USERS ({len(users)})</b>\n']
    for i, u in enumerate(users, 1):
        uid = u.get('id', '?')
        blocked_icon = '⛔' if u.get('blocked') else '✅'
        visits = u.get('visits', 1)
        last_seen = u.get('last_seen', '?')[:16]
        lines.append(
            f'{blocked_icon} <code>#{i}</code> | <b>{uid}</b> '
            f'| 👁 {visits}x | 📅 {last_seen}'
        )

    full_text = '\n'.join(lines)

    # Split into chunks if too long (Telegram limit: 4096 chars)
    chunk_size = 3900
    if len(full_text) > chunk_size:
        chunks = [full_text[i:i+chunk_size] for i in range(0, len(full_text), chunk_size)]
        for c in chunks:
            send_msg(c)
    else:
        send_msg(full_text)


def cmd_select(target):
    users_data = get_users_data()
    users = users_data.get('users', [])

    user = find_user(users, target)
    if not user:
        send_msg(f'❌ User "{target}" not found.\n\nUse /users to see all users.')
        return

    blocked = '⛔ BLOCKED' if user.get('blocked') else '✅ ACTIVE'
    msg = (
        f'👤 <b>USER SELECTED</b>\n\n'
        f'🆔 ID: <code>{user.get("id", "?")}</code>\n'
        f'📊 Status: {blocked}\n'
        f'👁 Visits: {user.get("visits", 1)}\n'
        f'📅 First seen: {user.get("first_seen", "?")[:16]}\n'
        f'📅 Last seen: {user.get("last_seen", "?")[:16]}\n'
        f'📝 Notes: {user.get("notes") or "None"}\n\n'
        f'<b>Actions:</b>\n'
        f'/block <code>{user["id"]}</code>\n'
        f'/unblock <code>{user["id"]}</code>\n'
        f'/note <code>{user["id"]}</code> <i>your text</i>'
    )
    send_msg(msg)


def cmd_block(target):
    users_data = get_users_data()
    users = users_data.get('users', [])
    user = find_user(users, target)

    if not user:
        send_msg(f'❌ User "{target}" not found.')
        return

    if user.get('blocked'):
        send_msg(f'⚠️ User <b>{user["id"]}</b> is already blocked.')
        return

    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    user['blocked'] = True
    user['blocked_at'] = timestamp

    save_users_data(users_data)
    send_msg(
        f'⛔ <b>USER BLOCKED</b>\n\n'
        f'🆔 ID: <code>{user["id"]}</code>\n'
        f'📊 Status: BLOCKED\n\n'
        f'<i>This user can no longer access DVC AI.</i>'
    )


def cmd_unblock(target):
    users_data = get_users_data()
    users = users_data.get('users', [])
    user = find_user(users, target)

    if not user:
        send_msg(f'❌ User "{target}" not found.')
        return

    if not user.get('blocked'):
        send_msg(f'✅ User <b>{user["id"]}</b> is not blocked.')
        return

    user['blocked'] = False
    if 'blocked_at' in user:
        del user['blocked_at']

    save_users_data(users_data)
    send_msg(
        f'✅ <b>USER UNBLOCKED</b>\n\n'
        f'🆔 ID: <code>{user["id"]}</code>\n'
        f'📊 Status: ACTIVE\n\n'
        f'<i>This user can now access DVC AI again.</i>'
    )


def cmd_note(target, text):
    users_data = get_users_data()
    users = users_data.get('users', [])
    user = find_user(users, target)

    if not user:
        send_msg(f'❌ User "{target}" not found.')
        return

    user['notes'] = text
    save_users_data(users_data)
    send_msg(f'📝 Note saved for <b>{user["id"]}</b>:\n\n<i>{text}</i>')


def cmd_broadcast(text):
    users_data = get_users_data()
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    users_data['broadcast'] = {
        'message': text,
        'timestamp': timestamp,
        'active': True
    }
    save_users_data(users_data)
    send_msg(
        f'📢 <b>BROADCAST SAVED!</b>\n\n'
        f'Message: <i>{text}</i>\n\n'
        f'<i>All users will see this when they visit DVC AI.</i>'
    )


def cmd_clearbroadcast():
    users_data = get_users_data()
    users_data['broadcast'] = {'message': '', 'timestamp': '', 'active': False}
    save_users_data(users_data)
    send_msg('✅ Broadcast cleared. Users will no longer see it.')


def cmd_help():
    msg = (
        '🤖 <b>DVC AI — BOT COMMANDS</b>\n\n'
        '<b>Server Control:</b>\n'
        '/on → Turn server ONLINE\n'
        '/off → Turn server OFFLINE\n'
        '/status → Server + user stats\n\n'
        '<b>User Management:</b>\n'
        '/users → List all users with IDs\n'
        '/select &lt;num/id&gt; → Select user\n'
        '/block &lt;id&gt; → Block user\n'
        '/unblock &lt;id&gt; → Unblock user\n'
        '/note &lt;id&gt; &lt;text&gt; → Add note\n\n'
        '<b>Broadcast:</b>\n'
        '/broadcast &lt;msg&gt; → Message all users\n'
        '/clearbroadcast → Clear broadcast\n\n'
        '<i>Runs 24/7 on GitHub Actions — FREE!</i>'
    )
    send_msg(msg)


# ============ MAIN ============
def process_command(text):
    parts = text.strip().split(maxsplit=2)
    cmd_name = parts[0].lower() if parts else ''

    handlers = {
        '/on': cmd_on,
        '/off': cmd_off,
        '/status': cmd_status,
        '/users': cmd_users,
    }

    # Simple commands without args
    if cmd_name in handlers:
        handlers[cmd_name]()
        return True

    # Commands with args
    if cmd_name == '/select':
        if len(parts) >= 2:
            cmd_select(parts[1])
        else:
            send_msg('Usage: /select &lt;number&gt;\nExample: /select 1\nUse /users to list users.')
        return True

    if cmd_name == '/block':
        if len(parts) >= 2:
            cmd_block(parts[1])
        else:
            send_msg('Usage: /block &lt;id&gt;\nExample: /block DVC-ABC123')
        return True

    if cmd_name == '/unblock':
        if len(parts) >= 2:
            cmd_unblock(parts[1])
        else:
            send_msg('Usage: /unblock &lt;id&gt;\nExample: /unblock DVC-ABC123')
        return True

    if cmd_name == '/note':
        if len(parts) >= 3:
            cmd_note(parts[1], parts[2])
        elif len(parts) == 2:
            cmd_note(parts[1], '')
        else:
            send_msg('Usage: /note &lt;id&gt; &lt;text&gt;')
        return True

    if cmd_name == '/broadcast':
        if len(parts) >= 2:
            # Get everything after "/broadcast "
            rest = text.strip()[len('/broadcast'):].strip()
            cmd_broadcast(rest)
        else:
            send_msg('Usage: /broadcast &lt;message&gt;')
        return True

    if cmd_name == '/clearbroadcast':
        cmd_clearbroadcast()
        return True

    if cmd_name == '/help' or cmd_name == '/start':
        cmd_help()
        return True

    return False


def main():
    print('=== DVC AI Bot Worker (GitHub Actions) ===')

    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID or not GITHUB_TOKEN:
        print('ERROR: Missing required environment variables!')
        print('Set: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GITHUB_TOKEN')
        exit(1)

    # Load last processed update_id
    state = get_local_state()
    last_id = state.get('last_update_id', 0)
    print(f'Last processed update_id: {last_id}')

    # Poll for new messages
    updates = get_updates(offset=last_id if last_id else None)
    print(f'Received {len(updates)} new updates')

    processed_any = False
    max_id = last_id

    for update in updates:
        update_id = update.get('update_id', 0)
        if update_id <= last_id:
            continue

        msg_data = update.get('message', {})
        chat_id = str(msg_data.get('chat', {}).get('id', ''))

        # Security check - only respond to owner
        if chat_id != TELEGRAM_CHAT_ID:
            print(f'Ignoring unauthorized chat: {chat_id}')
            max_id = max(max_id, update_id)
            continue

        text = msg_data.get('text', '').strip()
        if not text:
            continue

        username = msg_data.get('from', {}).get('username', '?')
        print(f'[TG] @{username}: {text}')

        handled = process_command(text)
        if not handled and text.startswith('/'):
            send_msg(f'Unknown command. Type /help for help.')

        max_id = max(max_id, update_id)
        processed_any = True

    # Update state if we processed anything
    if max_id > last_id:
        state['last_update_id'] = max_id
        state['last_run'] = datetime.now(timezone.utc).isoformat()
        save_local_state(state)
        print(f'Updated state to {max_id}')

    if not processed_any:
        print('No new commands.')

    print('=== Done ===')


if __name__ == '__main__':
    main()
