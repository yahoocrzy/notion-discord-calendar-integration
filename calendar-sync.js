// Google Calendar to Notion and Discord Sync
const { google } = require('googleapis');
const { Client } = require('@notionhq/client');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// Initialize clients
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const calendar = google.calendar('v3');

// Configure Google auth
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

auth.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// Configuration
const config = {
  NOTION_DATABASE_ID: process.env.NOTION_CALENDAR_DB_ID,
  DISCORD_WEBHOOK_URL: process.env.DISCORD_CALENDAR_WEBHOOK,
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || 'primary',
  SYNC_INTERVAL_MINUTES: 15
};

// Track synced events to avoid duplicates
const syncedEvents = new Set();

// Create or update Notion page for calendar event
async function syncEventToNotion(event) {
  const properties = {
    'Title': {
      title: [{
        text: {
          content: event.summary || 'Untitled Event'
        }
      }]
    },
    'Start': {
      date: {
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date
      }
    },
    'Google Event ID': {
      rich_text: [{
        text: {
          content: event.id
        }
      }]
    },
    'Description': {
      rich_text: [{
        text: {
          content: event.description || ''
        }
      }]
    },
    'Location': {
      rich_text: [{
        text: {
          content: event.location || ''
        }
      }]
    },
    'Attendees': {
      rich_text: [{
        text: {
          content: event.attendees ? 
            event.attendees.map(a => a.email).join(', ') : ''
        }
      }]
    }
  };

  // Check if event already exists in Notion
  const existingPages = await notion.databases.query({
    database_id: config.NOTION_DATABASE_ID,
    filter: {
      property: 'Google Event ID',
      rich_text: {
        equals: event.id
      }
    }
  });

  if (existingPages.results.length > 0) {
    // Update existing page
    await notion.pages.update({
      page_id: existingPages.results[0].id,
      properties: properties
    });
    return { action: 'updated', page: existingPages.results[0] };
  } else {
    // Create new page
    const page = await notion.pages.create({
      parent: { database_id: config.NOTION_DATABASE_ID },
      properties: properties
    });
    return { action: 'created', page };
  }
}

// Send Discord notification for calendar event
async function notifyDiscord(event, action) {
  const eventDate = new Date(event.start.dateTime || event.start.date);
  const embed = {
    embeds: [{
      title: `📅 Calendar Event ${action === 'created' ? 'Added' : 'Updated'}`,
      description: event.summary,
      color: action === 'created' ? 0x00FF00 : 0x0077FF,
      fields: [
        {
          name: 'When',
          value: eventDate.toLocaleString(),
          inline: true
        },
        {
          name: 'Duration',
          value: calculateDuration(event.start, event.end),
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    }]
  };

  if (event.location) {
    embed.embeds[0].fields.push({
      name: 'Location',
      value: event.location,
      inline: true
    });
  }

  if (event.description) {
    embed.embeds[0].fields.push({
      name: 'Description',
      value: event.description.substring(0, 1024)
    });
  }

  // Check if event is within next 24 hours for urgency
  const hoursUntilEvent = (eventDate - new Date()) / (1000 * 60 * 60);
  if (hoursUntilEvent > 0 && hoursUntilEvent < 24) {
    embed.content = `@here ⏰ Reminder: Event starting in ${Math.round(hoursUntilEvent)} hours!`;
    embed.embeds[0].color = 0xFF0000; // Red for urgent
  }

  await axios.post(config.DISCORD_WEBHOOK_URL, embed);
}

// Calculate event duration
function calculateDuration(start, end) {
  const startDate = new Date(start.dateTime || start.date);
  const endDate = new Date(end.dateTime || end.date);
  const durationMs = endDate - startDate;
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Main sync function
async function syncCalendar() {
  try {
    console.log('🔄 Starting calendar sync...');
    
    // Get events from Google Calendar (next 30 days)
    const response = await calendar.events.list({
      auth: auth,
      calendarId: config.GOOGLE_CALENDAR_ID,
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items;
    console.log(`📋 Found ${events.length} events to sync`);

    for (const event of events) {
      try {
        // Sync to Notion
        const result = await syncEventToNotion(event);
        
        // Send Discord notification for new events
        if (result.action === 'created' && !syncedEvents.has(event.id)) {
          await notifyDiscord(event, 'created');
          syncedEvents.add(event.id);
        }
        
        console.log(`✅ ${result.action} event: ${event.summary}`);
      } catch (error) {
        console.error(`❌ Error syncing event ${event.summary}:`, error.message);
      }
    }

    // Check for upcoming events (next hour) and send reminders
    const upcomingEvents = events.filter(event => {
      const eventTime = new Date(event.start.dateTime || event.start.date);
      const hoursUntil = (eventTime - new Date()) / (1000 * 60 * 60);
      return hoursUntil > 0 && hoursUntil <= 1;
    });

    for (const event of upcomingEvents) {
      const reminderKey = `reminder-${event.id}`;
      if (!syncedEvents.has(reminderKey)) {
        await notifyDiscord(event, 'reminder');
        syncedEvents.add(reminderKey);
      }
    }

    console.log('✅ Calendar sync completed');
  } catch (error) {
    console.error('❌ Calendar sync error:', error);
    
    // Send error notification to Discord
    await axios.post(config.DISCORD_WEBHOOK_URL, {
      content: '❌ Calendar sync error occurred. Check logs for details.'
    });
  }
}

// Schedule sync every 15 minutes
cron.schedule(`*/${config.SYNC_INTERVAL_MINUTES} * * * *`, () => {
  syncCalendar();
});

// Initial sync on startup
syncCalendar();

console.log(`🚀 Calendar sync service started. Syncing every ${config.SYNC_INTERVAL_MINUTES} minutes.`);

// Keep the process running
process.on('SIGTERM', () => {
  console.log('📴 Calendar sync service shutting down...');
  process.exit(0);
});
