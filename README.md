# Notion-Discord-Calendar Integration

This repository contains integration tools to sync between Notion, Discord, and Google Calendar for team notifications and calendar management.

## Features

### 1. Discord Webhook Handler (`discord-webhook-handler.js`)
- Receives webhooks from Notion when pages are updated
- Forwards notifications to Discord with user mentions
- Maps Notion users to Discord users
- Formats updates with rich embeds

### 2. Calendar Sync (`calendar-sync.js`)
- Syncs Google Calendar events to Notion database
- Sends Discord notifications for new events
- Sends reminders 1 hour before events
- Updates existing events automatically
- Runs every 15 minutes

## Setup Instructions

### Prerequisites
- Node.js 16+ installed
- Discord server with webhook permissions
- Notion workspace with API access
- Google Cloud project with Calendar API enabled

### Step 1: Clone and Install
```bash
git clone https://github.com/yahoocrzy/notion-discord-calendar-integration.git
cd notion-discord-calendar-integration
npm install
cp .env.example .env
```

### Step 2: Discord Setup

1. **Create Webhooks**:
   - Go to Discord Server Settings → Integrations → Webhooks
   - Create two webhooks:
     - "Notion Updates" for general notifications
     - "Calendar Events" for calendar notifications
   - Copy the webhook URLs

2. **Get User IDs** (for mentions):
   - Enable Developer Mode in Discord settings
   - Right-click users and copy their IDs

### Step 3: Notion Setup

1. **Create Integration**:
   - Go to https://www.notion.so/my-integrations
   - Create new integration with these permissions:
     - Read content
     - Update content
     - Insert content
   - Copy the API key

2. **Create Calendar Database**:
   - Create a new database in Notion with these properties:
     - Title (title)
     - Start (date)
     - Google Event ID (text)
     - Description (text)
     - Location (text)
     - Attendees (text)
   - Share the database with your integration
   - Copy the database ID from the URL

### Step 4: Google Calendar Setup

1. **Create Google Cloud Project**:
   - Go to https://console.cloud.google.com
   - Create new project
   - Enable Google Calendar API

2. **Create OAuth Credentials**:
   - Go to APIs & Services → Credentials
   - Create OAuth 2.0 Client ID
   - Add redirect URI: `http://localhost:3000/auth/callback`
   - Download credentials JSON

3. **Get Refresh Token**:
   - Use Google's OAuth playground or create a simple auth flow
   - Authorize with Calendar scope
   - Get refresh token

### Step 5: Environment Configuration

Edit `.env` with your values:
```env
# Discord
DISCORD_WEBHOOK_URL=your_notion_webhook_url
DISCORD_CALENDAR_WEBHOOK=your_calendar_webhook_url

# Notion
NOTION_API_KEY=your_notion_api_key
NOTION_SECRET=your_webhook_secret
NOTION_CALENDAR_DB_ID=your_calendar_database_id

# Google Calendar
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token
```

### Step 6: User Mapping

Edit `discord-webhook-handler.js` and add your team's user mapping:
```javascript
const userMapping = {
  'notion-user-id-1': '<@discord-user-id-1>',
  'notion-user-id-2': '<@discord-user-id-2>',
  // Add all team members
};
```

## Running the Services

### Option 1: Run Both Services
```bash
npm start           # Runs webhook handler
npm run calendar-sync  # In another terminal
```

### Option 2: Use Process Manager (PM2)
```bash
npm install -g pm2
pm2 start discord-webhook-handler.js --name "notion-discord"
pm2 start calendar-sync.js --name "calendar-sync"
pm2 save
pm2 startup
```

### Option 3: Deploy to Cloud
- Deploy to services like Heroku, Railway, or Render
- Set environment variables in the platform
- Ensure the webhook endpoint is publicly accessible

## Testing

### Test Discord Webhooks
```bash
curl -X POST http://localhost:3000/health
```

### Test Notion Webhook
```bash
curl -X POST http://localhost:3000/notion-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "page": {
      "title": "Test Page",
      "url": "https://notion.so/test"
    },
    "user": {
      "id": "test-user-id",
      "name": "Test User"
    },
    "type": "page_update",
    "changes": ["Title updated"]
  }'
```

## Troubleshooting

### Notifications not working
1. Check webhook URLs are correct
2. Verify API keys are valid
3. Check console logs for errors
4. Test webhooks manually with curl

### Calendar sync issues
1. Verify Google OAuth is properly configured
2. Check Notion database has correct properties
3. Ensure refresh token is valid
4. Check Google Calendar ID

### User mentions not working
1. Verify Discord user IDs are correct
2. Check user mapping in the code
3. Ensure bot has permission to mention users

## Contributing
Feel free to submit issues or pull requests for improvements!

## Security Notes
- Never commit `.env` file
- Keep API keys secure
- Use environment variables in production
- Rotate keys regularly

## Support
For help, check the logs or reach out in the #company-tools Discord channel.
