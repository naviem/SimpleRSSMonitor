const axios = require('axios');
const { EmbedBuilder } = require('discord.js'); // Only EmbedBuilder is needed from discord.js for webhooks
const TelegramBot = require('node-telegram-bot-api');

// Helper to get field value, supporting dot notation for nested properties (simple version)
function getFieldValue(item, fieldName) {
    if (!fieldName) return '';
    // Basic protection against prototype pollution, though less critical for read-only access
    if (fieldName === '__proto__' || fieldName === 'constructor' || fieldName === 'prototype') {
        return '';
    }
    // Handle cases where item might be null or undefined, or path is invalid
    try {
        return fieldName.split('.').reduce((o, k) => (o || {})[k], item) || '';
    } catch (e) {
        return '';
    }
}

// Discord notification queue and processor
const discordQueues = {};
const DISCORD_DELAY_MS = 1000; // 1 second delay

function queueDiscordNotification(webhookUrl, ...args) {
    if (!discordQueues[webhookUrl]) {
        discordQueues[webhookUrl] = [];
    }
    discordQueues[webhookUrl].push(args);
    if (discordQueues[webhookUrl].length === 1) {
        processDiscordQueue(webhookUrl);
    }
}

async function processDiscordQueue(webhookUrl) {
    const queue = discordQueues[webhookUrl];
    if (!queue || queue.length === 0) return;
    const args = queue[0];
    await sendDiscordNotification(...args);
    queue.shift();
    if (queue.length > 0) {
        setTimeout(() => processDiscordQueue(webhookUrl), DISCORD_DELAY_MS);
    }
}

async function sendDiscordNotification(webhookUrl, feedTitleFromFeedObject, item, selectedFields, feedOriginalUrl, showAllPrefixesFlag) {
    if (!webhookUrl) {
        console.warn('Discord webhook URL not provided.');
        return;
    }

    // Determine actual title and link based on selectedFields
    let itemTitle = '';
    let itemLink = null;
    if (selectedFields.includes('title')) {
        itemTitle = String(getFieldValue(item, 'title') || 'New RSS Item').substring(0, 250);
    }
    if (selectedFields.includes('link')) {
        itemLink = getFieldValue(item, 'link');
    }

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setAuthor({ name: String(feedTitleFromFeedObject).substring(0, 250) })
        .setTimestamp(item.isoDate ? new Date(item.isoDate) : new Date()) // Keep timestamp logic
        .setFooter({ text: 'Simple RSS Monitor' });

    if (itemTitle) {
        embed.setTitle(itemTitle);
        if (itemLink) {
            embed.setURL(itemLink);
        }
    } else if (itemLink) { // If no title but link is selected, Discord uses the URL as title
        embed.setTitle(itemLink.substring(0,250));
        embed.setURL(itemLink);
    }

    let description = '';
    const noPrefixFields = ['title', 'link', 'contentSnippet', 'content', 'summary', 'description', 'summary_text', 'content_text', 'description_text'];

    selectedFields.forEach(fieldKey => {
        if (fieldKey === 'title' || fieldKey === 'link') return; // Already handled by embed title/URL

        const rawValue = getFieldValue(item, fieldKey);
        const value = String(rawValue);

        if (value) { // Only add if there's a value
            const isOriginallyContentField = noPrefixFields.includes(fieldKey);

            if (showAllPrefixesFlag) { // Toggle ON: All fields get a prefix
                let fieldName = fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1);
                if (fieldKey === 'pubDate' || fieldKey === 'isoDate') {
                    // Special handling for pubDate/isoDate prefix and value
                    if ( (fieldKey === 'isoDate' && !item.isoDate) || 
                         (fieldKey === 'pubDate' && !item.isoDate) || 
                         (fieldKey === 'pubDate' && item.isoDate && getFieldValue(item, 'pubDate') !== getFieldValue(item, 'isoDate')) ) {
                        description += `**${fieldName}:** ${new Date(value).toLocaleString()}\n`;
                    }
                } else {
                    // Standard prefix for other fields
                    description += `**${fieldName}:** ${value.substring(0, isOriginallyContentField ? 2000 : 200)}${value.length > (isOriginallyContentField ? 2000 : 200) ? '...' : ''}\n`;
                }
            } else { // Toggle OFF: No fields get a prefix, just their value
                // pubDate/isoDate are only shown if not the main timestamp, and without prefix here
                if (fieldKey === 'pubDate' || fieldKey === 'isoDate') {
                    if ( (fieldKey === 'isoDate' && !item.isoDate) || 
                         (fieldKey === 'pubDate' && !item.isoDate) || 
                         (fieldKey === 'pubDate' && item.isoDate && getFieldValue(item, 'pubDate') !== getFieldValue(item, 'isoDate')) ) {
                        description += `${new Date(value).toLocaleString()}\n`;
                    }
                } else {
                    // Value without prefix. Length depends on if it was originally a content field.
                    description += `${value.substring(0, isOriginallyContentField ? 2000 : 200)}${value.length > (isOriginallyContentField ? 2000 : 200) ? '...' : ''}\n`;
                }
            }
        }
    });
    
    if (description.trim()) {
        embed.setDescription(description.trim().substring(0, 4000)); 
    }
    
    try {
        await axios.post(webhookUrl, {
            // username: "RSS Bot", // Optional: customize bot name
            // avatar_url: "your_avatar_url.png", // Optional: customize bot avatar
            embeds: [embed.toJSON()],
        });
        console.log(`Sent Discord notification for "${itemTitle || 'an item'}" from "${feedTitleFromFeedObject}"`);
    } catch (error) {
        console.error('Error sending Discord notification:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

async function sendTelegramNotification(botToken, chatId, feedTitleFromFeedObject, item, selectedFields, feedUrl, showAllPrefixesFlag) {
    if (!botToken || !chatId) {
        console.warn('Telegram bot token or chat ID not provided.');
        return;
    }

    const bot = new TelegramBot(botToken);

    // Helper to escape text for MarkdownV2
    const escape = (text) => text.replace(/[_*[\]()~`>#+=|{}.!\-]/g, '\\$&');

    // Feed Title (always included by default, bolded)
    let message = `*${escape(feedTitleFromFeedObject)}*\n`;

    // Determine Item Title and Link based on selectedFields
    let itemTitle = '';
    let itemLink = '';
    if (selectedFields.includes('title')) {
        itemTitle = String(getFieldValue(item, 'title') || 'New RSS Item');
    }
    if (selectedFields.includes('link')) {
        itemLink = getFieldValue(item, 'link');
    }

    if (itemTitle) {
        if (itemLink) {
            // URL part of a markdown link should not have its special characters escaped,
            // but parentheses need to be URL-encoded.
            const encodedLink = itemLink.replace(/\(/g, '%28').replace(/\)/g, '%29');
            message += `[${escape(itemTitle)}](${encodedLink})\n\n`;
        } else {
            message += `*${escape(itemTitle)}*\n\n`;
        }
    } else if (itemLink) {
        const encodedLink = itemLink.replace(/\(/g, '%28').replace(/\)/g, '%29');
        message += `[${escape(itemLink)}](${encodedLink})\n\n`;
    }

    const noPrefixFieldsTg = ['title', 'link', 'contentSnippet', 'content', 'summary', 'description', 'summary_text', 'content_text', 'description_text'];

    // Process other selected fields
    selectedFields.forEach(fieldKey => {
        if (fieldKey === 'title' || fieldKey === 'link') return;

        const rawValue = getFieldValue(item, fieldKey);
        const value = String(rawValue);

        if (value) {
            const isOriginallyContentFieldTg = noPrefixFieldsTg.includes(fieldKey);
            const valToDisplay = value.substring(0, isOriginallyContentFieldTg ? 2000 : 200);

            if (showAllPrefixesFlag) {
                let fieldName = fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1);
                message += `*${escape(fieldName)}*: ${escape(valToDisplay)}${value.length > valToDisplay.length ? '...' : ''}\n`;
            } else {
                message += `_${escape(valToDisplay)}${value.length > valToDisplay.length ? '...' : ''}_\n`;
            }
        }
    });

    // Send message
    try {
        await bot.sendMessage(chatId, message.trim(), { parse_mode: 'MarkdownV2' });
        console.log(`Sent Telegram notification for "${itemTitle || 'an item'}" from "${feedTitleFromFeedObject}"`);
    } catch (error) {
        console.error('Error sending MarkdownV2 Telegram notification:', error.message);
        try {
            const plainTextMessage = message.replace(/[_*[\]()~`>#+=|{}.!\-]/g, '');
            await bot.sendMessage(chatId, plainTextMessage.trim());
            console.log(`Sent Telegram notification (plain text fallback) for "${itemTitle || 'an item'}" from "${feedTitleFromFeedObject}"`);
        } catch (fallbackError) {
            console.error('Error sending plain text fallback Telegram notification:', fallbackError.message);
        }
    }
}

// MODIFIED: Function now only notifies integrations associated with the specific feed
function notifyIntegrationsForFeed(feed, item) {
    const { title: feedTitle, url: feedOriginalUrl, selectedFields, associatedIntegrations, showAllPrefixes } = feed;

    if (!associatedIntegrations || associatedIntegrations.length === 0) {
        // console.log(`Feed ${feedTitle} has no associated integrations. No notifications sent.`);
        return; // No specific integrations to notify for this feed
    }

    // Filter the global integrations list to get only the ones associated with this feed
    const targetIntegrations = global.integrations.filter(integ => 
        associatedIntegrations.includes(integ.id)
    );

    if (targetIntegrations.length === 0) {
        // This case might happen if associatedIntegrations contains IDs that no longer exist
        // console.log(`No matching active integrations found for feed ${feedTitle} from its associated list. Potential stale data.`);
        return;
    }

    // console.log(`Notifying ${targetIntegrations.length} associated integrations for feed ${feedTitle}`);

    targetIntegrations.forEach(integration => {
        if (integration.type === 'discord' && integration.webhookUrl) {
            queueDiscordNotification(
                integration.webhookUrl,
                integration.webhookUrl,
                feedTitle,
                item,
                selectedFields,
                feedOriginalUrl,
                !!showAllPrefixes
            );
        } else if (integration.type === 'telegram' && integration.token && integration.chatId) {
            sendTelegramNotification(integration.token, integration.chatId, feedTitle, item, selectedFields, feedOriginalUrl, !!showAllPrefixes);
        } else {
            // console.warn(`Integration ${integration.name} (${integration.id}) for feed ${feedTitle} has an unknown type or is misconfigured.`);
        }
    });
}

module.exports = {
    getFieldValue,
    sendDiscordNotification,
    sendTelegramNotification,
    notifyIntegrationsForFeed
}; 