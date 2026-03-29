import { getAccount } from "./config.js";
import { getAccessToken } from "./auth.js";
import { createGraphClient } from "./graph.js";

async function main() {
  const account = getAccount('boc');
  const token = await getAccessToken(account);
  const client = createGraphClient(token);

  const response = await client.api('/me/mailFolders/Drafts/messages')
    .top(5)
    .select('id,subject,toRecipients,createdDateTime,body')
    .orderby('createdDateTime desc')
    .get();

  for (const msg of response.value || []) {
    const to = (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', ');
    console.log('========================================');
    console.log('To:', to);
    console.log('Subject:', msg.subject);
    console.log('Date:', msg.createdDateTime);
    console.log('Body:');
    // Strip HTML tags for readability
    const text = msg.body?.content?.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(text?.substring(0, 1500));
    console.log('');
  }
}
main();
