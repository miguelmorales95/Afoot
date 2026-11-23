/**
 * Gmail Newsletter Scanner
 *
 * Setup:
 *   1. npm install googleapis google-auth-library dotenv
 *   2. Create a Google Cloud project + OAuth 2.0 credential (https://console.cloud.google.com)
 *   3. Download the JSON key, save as credentials.json in this directory
 *   4. First run: node scan-newsletters.js
 *      (opens browser, you click "allow", token saved to .env.local)
 *   5. Future runs: just node scan-newsletters.js (uses cached token)
 *
 * Output: newsletters.csv (email, domain, frequency, signal, last_issue, subject_pattern)
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/authenticate-service-account');
require('dotenv').config({ path: '.env.local' });

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Keywords to identify event-related newsletters
const EVENT_KEYWORDS = [
  'event', 'happening', 'this week', 'this weekend', 'tonight', 'concert',
  'show', 'party', 'night', 'music', 'festival', 'schedule', 'lineup',
  'agenda', 'coming up', 'live', 'performance', 'gallery', 'screening',
  'club', 'bar', 'venue', 'cultural', 'art exhibition'
];

const NEWSLETTER_DOMAINS = [
  'substack.com', 'mail.mailchimp.com', 'newsletter.com', 'crunchbase.com',
  'substack', 'sendgrid.net', 'campaignmonitor.com', 'getresponse.com'
];

async function authorize() {
  let auth;

  // Check if token already exists
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:3000/oauth2callback'
    );
    auth.setCredentials(token);
    return auth;
  }

  // First time: load credentials and start OAuth flow
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ credentials.json not found. Download it from Google Cloud Console:');
    console.error('   https://console.cloud.google.com/apis/credentials');
    console.error('   Create OAuth 2.0 credential (Desktop/Other), download as JSON');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed;

  auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Generate auth URL
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('🔗 Open this link in your browser (incognito is fine):');
  console.log(authUrl);
  console.log('\nAfter you click "Allow", copy the authorization code from the URL and paste it here:');

  // Simple readline to get the code
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Authorization code: ', async (code) => {
      rl.close();
      try {
        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);
        // Save token for next run
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        console.log('✅ Token saved. Future runs will use this.');
        resolve(auth);
      } catch (err) {
        console.error('❌ Error getting token:', err);
        process.exit(1);
      }
    });
  });
}

function scoreNewsletter(senderEmail, subject) {
  const subjectLower = (subject || '').toLowerCase();
  const hasEventKeyword = EVENT_KEYWORDS.some(kw => subjectLower.includes(kw));

  // High signal: clearly event-related
  if (hasEventKeyword && subjectLower.includes('week')) return 'HIGH';
  if (hasEventKeyword && subjectLower.includes('weekend')) return 'HIGH';
  if (hasEventKeyword && subject.match(/\d{4,}/)) return 'HIGH'; // has dates

  // Medium: might be events
  if (hasEventKeyword) return 'MEDIUM';

  // Check domain: some domains are more likely to be newsletters
  if (senderEmail.includes('kcrw') || senderEmail.includes('ra.com') || senderEmail.includes('eventbrite')) return 'HIGH';
  if (senderEmail.includes('timeout') || senderEmail.includes('thrillist')) return 'MEDIUM';

  return 'LOW';
}

async function scanInbox(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  console.log('📧 Fetching inbox messages...');

  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:noreply OR from:newsletter OR from:info OR from:events', // Filter common newsletter senders
      maxResults: 100, // Scan last 100 messages
      fields: 'messages(id,threadId)',
    });

    if (!res.data.messages) {
      console.log('No messages found');
      return [];
    }

    const newsletters = {};

    for (const msg of res.data.messages.slice(0, 50)) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = full.data.payload.headers;
      const fromHeader = headers.find(h => h.name === 'From');
      const subjectHeader = headers.find(h => h.name === 'Subject');
      const dateHeader = headers.find(h => h.name === 'Date');

      if (!fromHeader) continue;

      const from = fromHeader.value;
      const emailMatch = from.match(/<(.+?)>|(.+)/);
      const senderEmail = emailMatch ? (emailMatch[1] || emailMatch[2]) : from;
      const subject = subjectHeader?.value || '(no subject)';
      const date = dateHeader?.value || '';

      // Extract domain
      const domainMatch = senderEmail.match(/@([^>]+)/);
      const domain = domainMatch ? domainMatch[1] : senderEmail;

      // Skip if we've already seen this sender
      if (newsletters[senderEmail]) {
        newsletters[senderEmail].subjects.push(subject);
        newsletters[senderEmail].dates.push(date);
        continue;
      }

      const signal = scoreNewsletter(senderEmail, subject);

      newsletters[senderEmail] = {
        sender: senderEmail,
        domain,
        signal,
        subjects: [subject],
        dates: [date],
      };
    }

    // Format and dedupe
    const result = Object.values(newsletters)
      .sort((a, b) => {
        const signalOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return signalOrder[a.signal] - signalOrder[b.signal];
      })
      .map(nl => ({
        sender: nl.sender,
        domain: nl.domain,
        signal: nl.signal,
        frequency: nl.subjects.length > 1 ? `~${Math.round(nl.subjects.length / 2)} per month` : 'unknown',
        last_issue: nl.dates[0] || 'unknown',
        subject_patterns: nl.subjects.slice(0, 3).join(' | '),
      }));

    return result;
  } catch (err) {
    console.error('❌ Error scanning inbox:', err);
    process.exit(1);
  }
}

async function saveToCSV(newsletters) {
  const csv = [
    'sender,domain,signal,frequency,last_issue,subject_patterns',
    ...newsletters.map(nl =>
      [
        `"${nl.sender}"`,
        `"${nl.domain}"`,
        nl.signal,
        `"${nl.frequency}"`,
        `"${nl.last_issue}"`,
        `"${nl.subject_patterns}"`,
      ].join(',')
    ),
  ].join('\n');

  fs.writeFileSync('newsletters.csv', csv);
  console.log(`✅ Saved ${newsletters.length} newsletters to newsletters.csv`);
}

async function main() {
  const auth = await authorize();
  const newsletters = await scanInbox(auth);

  console.log('\n📋 Found newsletters:');
  newsletters.forEach(nl => {
    console.log(`  [${nl.signal}] ${nl.sender} (${nl.domain})`);
    console.log(`      Last: ${nl.last_issue}`);
    console.log(`      Subjects: ${nl.subject_patterns.substring(0, 80)}...`);
  });

  await saveToCSV(newsletters);
}

main();
