// Chat Export and Archive System
// Exports chats from Discord, organizes them, and archives to Notion

const { Client: DiscordClient, GatewayIntentBits } = require('discord.js');
const { Client: NotionClient } = require('@notionhq/client');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

// Initialize clients
const discord = new DiscordClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const notion = new NotionClient({
  auth: process.env.NOTION_API_KEY
});

// Configuration
const config = {
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  NOTION_CHAT_DB_ID: process.env.NOTION_CHAT_ARCHIVE_DB_ID,
  EXPORT_CHANNEL_IDS: process.env.DISCORD_EXPORT_CHANNELS?.split(',') || [],
  EXPORT_FOLDER: './exports',
  ARCHIVE_AFTER_DAYS: 7
};

// Tag classification rules
const TAG_RULES = {
  'NetSuite/P21': ['netsuite', 'p21', 'erp', 'integration'],
  'Business': ['meeting', 'strategy', 'planning', 'budget'],
  'Development': ['code', 'github', 'deploy', 'bug', 'feature'],
  'Tools': ['notion', 'discord', 'chatgpt', 'claude', 'shareX'],
  'Vegas/MGM': ['vegas', 'mgm', 'conference', 'travel'],
  'Family': ['family', 'personal', 'vacation'],
  'Tech/Hardware': ['server', 'hardware', 'network', 'setup']
};

// Auto-classify messages based on content
function classifyMessage(content) {
  const lowerContent = content.toLowerCase();
  
  for (const [tag, keywords] of Object.entries(TAG_RULES)) {
    if (keywords.some(keyword => lowerContent.includes(keyword))) {
      return tag;
    }
  }
  
  return 'Uncategorized';
}

// Export Discord channel messages to markdown
async function exportChannelToMarkdown(channel, days = 7) {
  const messages = [];
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  
  console.log(`📥 Exporting messages from #${channel.name}`);
  
  // Fetch messages
  let lastId;
  while (true) {
    const fetchedMessages = await channel.messages.fetch({
      limit: 100,
      before: lastId
    });
    
    if (fetchedMessages.size === 0) break;
    
    for (const msg of fetchedMessages.values()) {
      if (msg.createdAt < dateLimit) break;
      
      messages.push({
        id: msg.id,
        author: msg.author.username,
        authorId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdAt,
        attachments: msg.attachments.map(a => a.url),
        tag: classifyMessage(msg.content)
      });
    }
    
    lastId = fetchedMessages.last().id;
    if (fetchedMessages.last().createdAt < dateLimit) break;
  }
  
  // Create markdown
  let markdown = `# Discord Export: ${channel.name}\n\n`;
  markdown += `**Export Date:** ${new Date().toISOString()}\n`;
  markdown += `**Channel:** ${channel.name}\n`;
  markdown += `**Message Count:** ${messages.length}\n\n`;
  markdown += `---\n\n`;
  
  // Group by conversation threads
  const conversations = groupIntoConversations(messages);
  
  for (const conv of conversations) {
    markdown += `## Conversation: ${conv.title}\n`;
    markdown += `**Tags:** ${conv.tags.join(', ')}\n`;
    markdown += `**Participants:** ${conv.participants.join(', ')}\n\n`;
    
    for (const msg of conv.messages) {
      markdown += `### [${msg.author}] ${msg.timestamp.toISOString()}\n`;
      markdown += `${msg.content}\n\n`;
      
      if (msg.attachments.length > 0) {
        markdown += `**Attachments:**\n`;
        msg.attachments.forEach(url => {
          markdown += `- ${url}\n`;
        });
        markdown += '\n';
      }
    }
    
    markdown += `---\n\n`;
  }
  
  return { markdown, conversations };
}

// Group messages into conversation threads
function groupIntoConversations(messages) {
  const conversations = [];
  let currentConv = null;
  
  // Sort by timestamp
  messages.sort((a, b) => a.timestamp - b.timestamp);
  
  for (const msg of messages) {
    // Start new conversation if gap > 30 minutes
    const isNewConv = !currentConv || 
      (msg.timestamp - currentConv.messages[currentConv.messages.length - 1].timestamp) > 30 * 60 * 1000;
    
    if (isNewConv) {
      currentConv = {
        title: msg.content.substring(0, 50) + '...',
        messages: [],
        participants: new Set(),
        tags: new Set()
      };
      conversations.push(currentConv);
    }
    
    currentConv.messages.push(msg);
    currentConv.participants.add(msg.author);
    currentConv.tags.add(msg.tag);
  }
  
  // Convert sets to arrays
  conversations.forEach(conv => {
    conv.participants = Array.from(conv.participants);
    conv.tags = Array.from(conv.tags);
  });
  
  return conversations;
}

// Upload conversation to Notion
async function uploadToNotion(conversation, channelName) {
  const properties = {
    'Title': {
      title: [{
        text: {
          content: conversation.title
        }
      }]
    },
    'Channel': {
      select: {
        name: channelName
        }
    },
    'Tags': {
      multi_select: conversation.tags.map(tag => ({ name: tag }))
    },
    'Participants': {
      rich_text: [{
        text: {
          content: conversation.participants.join(', ')
        }
      }]
    },
    'Message Count': {
      number: conversation.messages.length
    },
    'Date Range': {
      date: {
        start: conversation.messages[0].timestamp.toISOString(),
        end: conversation.messages[conversation.messages.length - 1].timestamp.toISOString()
      }
    }
  };
  
  // Create page with conversation content
  const page = await notion.pages.create({
    parent: { database_id: config.NOTION_CHAT_DB_ID },
    properties: properties,
    children: [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: 'Conversation Export' }
          }]
        }
      },
      ...conversation.messages.map(msg => ({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: {
              content: `[${msg.author}] ${msg.timestamp.toISOString()}: ${msg.content}`
            }
          }]
        }
      }))
    ]
  });
  
  return page.id;
}

// Clear old messages from Discord channel
async function clearOldMessages(channel, days = 7) {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  
  console.log(`🗑️ Clearing messages older than ${days} days from #${channel.name}`);
  
  let deleted = 0;
  let lastId;
  
  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      before: lastId
    });
    
    if (messages.size === 0) break;
    
    for (const msg of messages.values()) {
      if (msg.createdAt < dateLimit && !msg.pinned) {
        try {
          await msg.delete();
          deleted++;
          // Rate limit protection
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Failed to delete message: ${error.message}`);
        }
      }
    }
    
    lastId = messages.last().id;
  }
  
  console.log(`✅ Deleted ${deleted} old messages`);
  return deleted;
}

// Main export and archive function
async function exportAndArchive() {
  console.log('🚀 Starting weekly export and archive process...');
  
  for (const channelId of config.EXPORT_CHANNEL_IDS) {
    try {
      const channel = await discord.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) continue;
      
      // Export messages
      const { markdown, conversations } = await exportChannelToMarkdown(channel);
      
      // Save markdown locally
      const filename = `${channel.name}_${new Date().toISOString().split('T')[0]}.md`;
      const filepath = path.join(config.EXPORT_FOLDER, filename);
      await fs.mkdir(config.EXPORT_FOLDER, { recursive: true });
      await fs.writeFile(filepath, markdown);
      
      console.log(`📄 Exported to ${filepath}`);
      
      // Upload each conversation to Notion
      for (const conv of conversations) {
        await uploadToNotion(conv, channel.name);
        // Rate limit protection
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`✅ Uploaded ${conversations.length} conversations to Notion`);
      
      // Clear old messages if configured
      if (process.env.AUTO_CLEAR_MESSAGES === 'true') {
        await clearOldMessages(channel, config.ARCHIVE_AFTER_DAYS);
      }
      
    } catch (error) {
      console.error(`Error processing channel ${channelId}:`, error);
    }
  }
  
  console.log('✅ Export and archive complete!');
}

// Discord bot ready
discord.once('ready', () => {
  console.log(`🤖 Logged in as ${discord.user.tag}`);
  
  // Schedule weekly export (Sunday at 2 AM)
  cron.schedule('0 2 * * 0', () => {
    exportAndArchive();
  });
  
  console.log('📅 Scheduled weekly exports for Sunday 2 AM');
});

// Manual export command
discord.on('messageCreate', async (message) => {
  if (message.content === '!export' && message.member?.permissions.has('Administrator')) {
    await message.reply('Starting manual export...');
    await exportAndArchive();
    await message.reply('Export complete! Check Notion for archives.');
  }
});

// Login
discord.login(config.DISCORD_TOKEN);

// Export function for use in other scripts
module.exports = { exportAndArchive, exportChannelToMarkdown };
