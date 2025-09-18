// Discord Webhook Handler for Notion Notifications
// This script receives webhooks from Notion and forwards them to Discord

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Configuration
const config = {
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
  NOTION_SECRET: process.env.NOTION_SECRET,
  PORT: process.env.PORT || 3000
};

// User mapping: Notion ID -> Discord ID
const userMapping = {
  // Add your team's mapping here
  // 'notion-user-id': '<@discord-user-id>',
};

// Verify Notion webhook signature
function verifyNotionSignature(payload, signature) {
  const hash = crypto
    .createHmac('sha256', config.NOTION_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
}

// Format Notion update for Discord
function formatDiscordMessage(notionData) {
  const { page, user, type, changes } = notionData;
  
  // Map Notion user to Discord user
  const discordUser = userMapping[user.id] || user.name;
  
  const embed = {
    embeds: [{
      title: '📝 Notion Update',
      color: 0x0077FF,
      fields: [
        {
          name: 'Page',
          value: `[${page.title}](${page.url})`,
          inline: true
        },
        {
          name: 'Updated By',
          value: user.name,
          inline: true
        },
        {
          name: 'Type',
          value: type,
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    }]
  };

  // Add mention if user is mapped
  if (userMapping[user.id]) {
    embed.content = `${discordUser} - New Notion update!`;
  }

  // Add specific changes
  if (changes && changes.length > 0) {
    embed.embeds[0].fields.push({
      name: 'Changes',
      value: changes.join('\\n').substring(0, 1024)
    });
  }

  return embed;
}

// Webhook endpoint
app.post('/notion-webhook', async (req, res) => {
  try {
    // Verify signature (if implemented by Notion)
    const signature = req.headers['x-notion-signature'];
    if (signature && !verifyNotionSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Format and send to Discord
    const discordMessage = formatDiscordMessage(req.body);
    
    await axios.post(config.DISCORD_WEBHOOK_URL, discordMessage);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    configured: {
      discord: !!config.DISCORD_WEBHOOK_URL,
      notion: !!config.NOTION_SECRET
    }
  });
});

app.listen(config.PORT, () => {
  console.log(`🚀 Webhook handler running on port ${config.PORT}`);
  console.log(`📍 Webhook endpoint: http://localhost:${config.PORT}/notion-webhook`);
});
