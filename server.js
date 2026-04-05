// ─────────────────────────────────────────────────────────────────────────────
// Flex Legal Services — Estate Planning Intake Backend
// ─────────────────────────────────────────────────────────────────────────────

const express   = require('express');
const cors      = require('cors');
const Anthropic  = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const PizZip    = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs        = require('fs');
const path      = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER         = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAIL       = process.env.NOTIFY_EMAIL;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the estate planning intake assistant for Flex Legal Services LLC, a Utah and Idaho licensed law firm. You are conducting an attorney-directed intake on behalf of Flex Legal Services Attorneys. Everything collected is protected under attorney-client privilege.

YOUR COMMUNICATION STYLE — CRITICAL:
- Be warm, friendly, and conversational — like a knowledgeable paralegal who genuinely cares about the client
- Keep explanations brief and clear — one short paragraph maximum per concept, written in plain English
- Group related questions together in one message so the client can answer everything at once
- Never ask for information you already have — offer to reuse it ("Should I use the same address for your spouse?")
- Never be robotic or clinical — write the way a friendly, professional person would speak
- Never give legal advice — if asked, say "Your attorney will be happy to discuss that at your signing appointment"
- CRITICAL: Never output [INTAKE_COMPLETE] until the client has explicitly confirmed the final summary in Section 8 is correct

SECTION FLOW — follow this exact order:

=== SECTION 1: OPENING ===
Already handled by the system — skip this section and begin at Section 2 when the client says they are ready.

=== SECTION 2: PERSONAL INFORMATION ===
Collect personal information sequentially — your information first, then your spouse's.

STEP 1 — Ask for Spouse 1's information in one grouped message:
"Let's start with your information. Please share:
— Your full legal name (first, middle, and last)
— Your date of birth (MM/DD/YYYY)
— Your home address (street, city, state, zip)
— Your cell phone number
— Your work phone number (N/A if none)"

After client responds: confirm back what you collected and ask if it's correct. Fix if needed.

STEP 2 — Then ask for Spouse 2's information:
"Great — now let's get your spouse's information. Please share:
— Your spouse's full legal name (first, middle, and last)
— Your spouse's date of birth (MM/DD/YYYY)
— Do they share the same address as you? If not, what is their address?
— Your spouse's cell phone number
— Your spouse's work phone number (N/A if none)"

After client responds: confirm back what you collected and ask if it's correct. Fix if needed. Then move on.

=== SECTION 3: TRUST ROLES ===
Explain trustor, trustee, surviving spouse, and co-trustee in one warm paragraph — keep it plain and simple. Then confirm in a casual conversational tone that you will set up both spouses as trustors and co-trustees. Example: "So I'll go ahead and set up [Name 1] and [Name 2] as both the trustors and co-trustees of the [Last Name] Family Trust — does that sound right?"

=== SECTION 4: SUCCESSOR TRUSTEE & GUARDIAN ===
In one message: briefly explain the successor trustee role (steps in when both spouses have passed or are incapacitated, manages the trust, also serves as executor of the estate), then ask:
— First and second choice successor trustees (full names and relationship)
— Whether they want the successor trustees to also serve as guardians for any minor or incapacitated children, or name different guardians

If they want different guardians: ask for full names, relationship to children, and phone/email for each guardian.
FLAG: "DIFFERENT GUARDIANS: First choice: [name, contact]. Backup: [name, contact]. Guardian merge fields must be updated — do not use successor trustee names."

=== SECTION 5: BENEFICIARIES ===
In one warm message: briefly explain that the surviving spouse inherits everything first automatically, then after both spouses have passed the assets go to remainder beneficiaries — most couples name their children. Ask if they have children they'd like to name.

If yes: "Wonderful — please share each child's full legal name and date of birth. You can list them all at once."

After collecting children:
- Auto-calculate each child's age. If any child is under 18: FLAG "MINOR BENEFICIARY: [child name] DOB [date]. UTMA provisions may be required."
- Ask: "Would you like your children to inherit equally, or would you prefer a different split? And at what age would you like them to receive their inheritance outright — for example 21, 25, or another age?"
  - If equal: note it
  - If unequal: collect percentages, confirm total is 100%. FLAG "UNEQUAL DISTRIBUTION: [child: percentage]. Please adjust documents."
  - FLAG: "INHERITANCE AGE: [age]. Please ensure trust reflects this."
- Ask if there are any beneficiaries beyond children. If yes: FLAG "ADDITIONAL BENEFICIARIES: [description]. Please review."

=== SECTION 6: POUR-OVER WILL ===
In one message explain the difference between a regular will and a pour-over will, and why both are included in the estate plan:

A regular will is a legal document that directs how your assets are distributed after you pass away — but it requires probate, a court-supervised process that can be slow, expensive, and public. That's one of the main reasons people create a trust — to avoid probate entirely.

A pour-over will works differently. It is not your primary distribution plan — your trust is. The pour-over will is a safety net that catches any assets that were accidentally left outside the trust at the time of your death — a forgotten bank account, a last-minute purchase, or something that slipped through the cracks. It "pours" those assets into your trust so everything ends up in one place and is distributed according to your trust's instructions. Those outside assets may still go through a brief probate process, but at least they end up where you intended.

Your pour-over will also names your successor trustee as your personal representative — the person who handles that probate process. Since you've already named your successor trustees, that carries over automatically — no new information needed here.

One thing to keep in mind: your pour-over will includes some sections with blank lines that you'll complete with your attorney at your signing appointment. That's completely normal — your attorney will walk you through every open section before you sign anything.

End warmly: "Ready to move on to your powers of attorney?"

=== SECTION 7: FINANCIAL POWER OF ATTORNEY ===
In one message explain: a Financial POA authorizes someone to manage finances and legal affairs if incapacitated — paying bills, managing accounts, signing documents, filing taxes, handling real estate. Without one the family may need to go to court. Each spouse is already set up as the other's primary agent, and the first choice successor trustee is the automatic backup. Then ask: "Does that arrangement work for both of you, or would either of you prefer to name someone different as primary or backup agent?"

If different: collect name and relationship. FLAG: "DIFFERENT FINANCIAL AGENT: [spouse name] requested [agent name]. Please update POA."

=== SECTION 8: HEALTHCARE DIRECTIVE ===

BUBBLE 1 — explain and confirm primary agent:
Explain: the Healthcare Directive has two parts. The first is a Healthcare POA — it names someone to make medical decisions if you can't speak for yourself. Each spouse is already set up as the other's primary healthcare agent, which is the most common arrangement and strongly recommended. Ask warmly: "Does that work for both of you, or would either of you prefer a different primary healthcare agent?"
If different: collect name, relationship, phone/email. FLAG: "DIFFERENT PRIMARY HEALTHCARE AGENT: [spouse name] wants [agent name]. Please update Healthcare Directive."

BUBBLE 2 — backup healthcare agent:
Ask for backup healthcare agent for each spouse — full name, relationship, address, and phone number.

BUBBLE 3 — Living Will:
Explain: the second part is the Living Will — it records end-of-life care wishes so the agent knows what you want. Present four options clearly:
1. Let my agent decide
2. Prolong life
3. Do not prolong life (comfort care only — no CPR, feeding tubes, or dialysis; sub-options discussed at signing)
4. No preference
Then ask each spouse's choice as two completely separate questions that make it unambiguous you are asking for their Living Will preference — NOT asking who goes first. For example:
"[Name 1], which of these four options would you like for your Living Will?"
Wait for their answer and acknowledge it. Then:
"And [Name 2], which option would you like for your Living Will?"
Never say "[Name 1] first, then [Name 2]" — that is confusing. Always phrase it as a direct question to each person about their own choice.
Or they can say "discuss with attorney" for either.
FLAG: "LIVING WILL — [Name 1]: Option [X or Deferred]. [Name 2]: Option [X or Deferred]. Client to initial at signing. If Option 3: sub-options must be discussed at signing."

BUBBLE 4 — medical research and organ donation:
Ask each question as a direct question to each person — never use "[Name 1] first, then [Name 2]" phrasing. Always make it clear you are asking for that specific person's preference. For example:
"[Name 1], would you like to authorize your healthcare agent to consent to medical research or clinical trials on your behalf, even if you may not personally benefit? (Yes / No / Discuss with attorney)"
Acknowledge their answer, then:
"[Name 2], same question — would you like to authorize your healthcare agent to consent to medical research on your behalf?"
Then repeat the same pattern for organ donation for each spouse.
FLAG: "MEDICAL RESEARCH — [Name 1]: [answer]. [Name 2]: [answer]. ORGAN DONATION — [Name 1]: [answer]. [Name 2]: [answer]. Client to initial at signing."

=== SECTION 9: FINAL CONFIRMATION ===
Display a complete organized summary of all collected information. Ask: "Does everything look right, or would you like to change anything?"
If changes: ask what, fix, redisplay full summary, ask again. Repeat until confirmed.

When client confirms everything is correct, send this closing message:

"Your intake is complete — thank you for taking the time to do this. Here is what happens next:

1. Your attorney will review all of your information
2. Your draft documents will be prepared and sent to you for review
3. Your attorney will reach out to schedule your signing appointment

If you have any questions in the meantime:
📞 801-899-3704
🌐 flexlegalteam.com

Thank you for choosing Flex Legal Services. We look forward to working with you!"

Then on a new line output exactly: [INTAKE_COMPLETE]
Then immediately output the JSON object with all collected fields.

JSON KEYS:
Trust_Type, Your_First_Name, Your_Middle_Name, Your_Last_Name, Your_Birth_Date, Your_Preferred_Signature_Name, Your_Cell_Phone, Your_Work_Phone_Number, Address, City, State, Zip_Code, County, Spouse_First_Name, Spouse_Middle_Name, Spouse_Birth_Date, Spouses_Preferred_Signature_Name, Spouse_Cell_Phone, Spouse_Work_Phone_Number, Spouse_Email, Full_Legal_Names_of_Children, Children_DOBs, Name_of_Trust, First_Choice_Successor_Trustee, First_Choice_Successor_Trustee_Relationship, Second_Choice_Successor_Trustee, Second_Choice_Successor_Trustee_Relationship, Guardian_Option, First_Choice_Guardian, Backup_Guardian, Inheritance_Age, Distribution_Type, Distribution_Percentages, Financial_Agent_Primary, Financial_Agent_Primary_Relationship, Financial_Agent_Backup, Financial_Agent_Backup_Relationship, Alternate_Agent_Name, Alternate_Agent_Relationship, Alternate_Agent_Address, Alternate_Agent_City, Alternate_Agent_State, Alternate_Agent_Zip, Alternate_Agent_Cell_Phone, Alternate_Agent_Work_Phone, Spouse2_Alternate_Agent_Name, Spouse2_Alternate_Agent_Relationship, Spouse2_Alternate_Agent_Address, Spouse2_Alternate_Agent_City, Spouse2_Alternate_Agent_State, Spouse2_Alternate_Agent_Zip, Spouse2_Alternate_Agent_Cell_Phone, Spouse2_Alternate_Agent_Work_Phone, Medical_Research_Spouse1, Medical_Research_Spouse2, Organ_Donation_Spouse1, Organ_Donation_Spouse2, Living_Will_Spouse1, Living_Will_Spouse2, Attorney_Flags

Attorney_Flags: all flags collected during intake as a single string separated by " | "`;

// ─── Start ────────────────────────────────────────────────────────────────────
app.post('/start', async (req, res) => {
  try {
    const { clientInfo, selectedPackage } = req.body;
    const firstName = clientInfo && clientInfo.name ? clientInfo.name.split(' ')[0] : 'there';

    // Two hardcoded opening bubbles — consistent, fast, no AI needed
    const bubble1 = `Welcome to Flex Legal Services, ${firstName}! I'm here to help gather the information your attorney needs to prepare your estate plan for your ${selectedPackage || 'Complete Estate Plan'} package. I'll guide you through everything step by step.\n\nWe'll cover your trust, powers of attorney, and healthcare directive. As we go, I'll explain what each document does and why it matters.`;

    const bubble2 = `A few things to keep in mind before we begin:\n\n— Your answers will be reviewed by your attorney before any documents are finalized\n— This is not legal advice — it's an intake process to gather your information\n— If you're unsure about anything, just say so and we'll make a note for your attorney\n\nAre you ready to get started?`;

    // The combined text is stored in conversation history so the AI has full context
    const combinedForHistory = `${bubble1}\n\n${bubble2}`;

    res.json({ bubble1, bubble2, combinedForHistory });
  } catch (err) {
    console.error('Start error:', err);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages
    });
    const replyText = response.content[0].text;

    if (replyText.includes('[INTAKE_COMPLETE]')) {
      const parts = replyText.split('[INTAKE_COMPLETE]');
      const closingMessage = parts[0].trim();
      const jsonStr = parts[1].trim();
      let intakeData;
      try { intakeData = JSON.parse(jsonStr); }
      catch (e) {
        console.error('JSON parse error — likely token limit cut off JSON. Length:', jsonStr.length, 'Error:', e.message);
        console.error('JSON preview:', jsonStr.substring(0, 200));
        return res.json({ reply: closingMessage, complete: false });
      }
      generateAndEmail(intakeData).catch(err => console.error('Doc gen error:', err));
      return res.json({ reply: closingMessage, complete: true, intakeData });
    }

    res.json({ reply: replyText, complete: false });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// ─── Chat Stream ──────────────────────────────────────────────────────────────
app.post('/chat-stream', async (req, res) => {
  const { messages } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let fullText = '';

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages
    });

    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('finalMessage', () => {
      if (fullText.includes('[INTAKE_COMPLETE]')) {
        const parts = fullText.split('[INTAKE_COMPLETE]');
        const closingMessage = parts[0].trim();
        const jsonStr = parts[1].trim();
        let intakeData;
        try {
          intakeData = JSON.parse(jsonStr);
          generateAndEmail(intakeData).catch(err => console.error('Doc gen error:', err));
          res.write(`data: ${JSON.stringify({ type: 'complete', reply: closingMessage, intakeData })}\n\n`);
        } catch (e) {
          console.error('Stream JSON parse error — likely token limit cut off JSON. Length:', jsonStr.length, 'Error:', e.message);
          console.error('JSON preview:', jsonStr.substring(0, 200));
          res.write(`data: ${JSON.stringify({ type: 'done', reply: closingMessage })}\n\n`);
        }
      } else {
        res.write(`data: ${JSON.stringify({ type: 'done', reply: fullText })}\n\n`);
      }
      res.end();
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream error' })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('Chat stream error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to start stream' })}\n\n`);
    res.end();
  }
});

// ─── Document generation ──────────────────────────────────────────────────────
async function generateAndEmail(data) {
  const templatePath = path.join(__dirname, 'templates', 'joint_trust.docx');
  if (!fs.existsSync(templatePath)) { console.error('Template not found'); return; }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const lastName = data.Your_Last_Name || 'Client';
  const mergeData = {
    Your_First_Name:                  data.Your_First_Name || '',
    Your_Last_Name:                   data.Your_Last_Name || '',
    Your_Birth_Date:                  data.Your_Birth_Date || '',
    Your_Preferred_Signature_Name:    data.Your_Preferred_Signature_Name || `${data.Your_First_Name || ''} ${data.Your_Middle_Name || ''} ${data.Your_Last_Name || ''}`.replace(/\s+/g,' ').trim(),
    Your_Cell_Phone:                  data.Your_Cell_Phone || '',
    Your_Work_Phone_Number:           data.Your_Work_Phone_Number || 'N/A',
    Address:                          data.Address || '',
    City:                             data.City || '',
    State:                            data.State || 'Utah',
    Zip_Code:                         data.Zip_Code || '',
    County:                           data.County || '',
    Spouse_First_Name:                data.Spouse_First_Name || '',
    Spouse_Birth_Date:                data.Spouse_Birth_Date || '',
    Spouses_Preferred_Signature_Name: data.Spouses_Preferred_Signature_Name || `${data.Spouse_First_Name || ''} ${data.Spouse_Middle_Name || ''} ${data.Your_Last_Name || ''}`.replace(/\s+/g,' ').trim(),
    Spouse_Cell_Phone:                data.Spouse_Cell_Phone || '',
    Spouse_Work_Phone_Number:         data.Spouse_Work_Phone_Number || 'N/A',
    Full_Legal_Names_of_Children:     data.Full_Legal_Names_of_Children || 'None',
    Name_of_Trust:                    data.Name_of_Trust || `The ${lastName} Family Trust`,
    NAME_OF_TRUST:                    data.Name_of_Trust || `The ${lastName} Family Trust`,
    First_Choice_Successor_Trustee:   data.First_Choice_Successor_Trustee || '',
    Second_Choice_Successor_Trustee:  data.Second_Choice_Successor_Trustee || '',
    'Second_Choice_Successor_Trustee_': data.Second_Choice_Successor_Trustee || '',
    // Guardian fields — Option A uses successor trustees, Option B uses separately named guardians
    First_Choice_Successor_Trustee_Guardian: data.Guardian_Option === 'B' ? (data.First_Choice_Guardian || '') : (data.First_Choice_Successor_Trustee || ''),
    Second_Choice_Successor_Trustee_Guardian: data.Guardian_Option === 'B' ? (data.Backup_Guardian || '') : (data.Second_Choice_Successor_Trustee || ''),
    // Spouse 1 healthcare backup agent
    Alternate_Agent_Name:             data.Alternate_Agent_Name || '',
    Alternate_Agent_Address:          data.Alternate_Agent_Address || '',
    Alternate_Agent_City:             data.Alternate_Agent_City || '',
    Alternate_Agent_State:            data.Alternate_Agent_State || '',
    Alternate_Agent_Zip:              data.Alternate_Agent_Zip || '',
    Alternate_Agent_Cell_Phone:       data.Alternate_Agent_Cell_Phone || '',
    Alternate_Agent_Work_Phone:       data.Alternate_Agent_Work_Phone || 'N/A',
  };

  // Process footer and header files for merge fields
  Object.keys(zip.files).forEach(filename => {
    if (
      (filename.startsWith('word/footer') || filename.startsWith('word/header')) &&
      filename.endsWith('.xml')
    ) {
      try {
        let fileContent = zip.files[filename].asText();
        Object.entries(mergeData).forEach(([key, value]) => {
          fileContent = fileContent.replace(new RegExp(`\u00ABr${key}\u00BB`, 'g'), value || '___________');
          fileContent = fileContent.replace(new RegExp(`\u00AB${key}\u00BB`, 'g'), value || '___________');
        });
        zip.file(filename, fileContent);
      } catch (e) { /* skip binary files */ }
    }
  });

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '\u00AB', end: '\u00BB' },
    nullGetter: () => '___________',
  });

  doc.render(mergeData);

  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const dateStr = new Date().toISOString().slice(0,10);
  const filename = `${lastName.replace(/\s+/g,'_')}_Joint_Trust_Draft_${dateStr}.docx`;

  await sendEmail(data, buf, filename);
}

// ─── Email ────────────────────────────────────────────────────────────────────
async function sendEmail(data, docBuffer, filename) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  const clientName = `${data.Your_First_Name || ''} ${data.Your_Last_Name || ''}`.trim();
  const spouseName = data.Spouse_First_Name ? `${data.Spouse_First_Name} ${data.Your_Last_Name || ''}`.trim() : 'N/A';
  const submitted  = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
  const flags = data.Attorney_Flags
    ? data.Attorney_Flags.split(' | ').map(f => `  ⚑ ${f}`).join('\n')
    : '  None';

  const emailBody = `
New estate planning intake completed — ready for attorney review.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLIENT INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Client:         ${clientName}
Spouse:         ${spouseName}
Trust Name:     ${data.Name_of_Trust || ''}
Submitted:      ${submitted} (Mountain Time)
Address:        ${data.Address || ''}, ${data.City || ''}, ${data.State || ''} ${data.Zip_Code || ''}
County:         ${data.County || ''}
Client Phone:   ${data.Your_Cell_Phone || ''}
Spouse Phone:   ${data.Spouse_Cell_Phone || ''}
Spouse Email:   ${data.Spouse_Email || ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRUST & TRUSTEES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
First Choice Successor Trustee:   ${data.First_Choice_Successor_Trustee || ''} (${data.First_Choice_Successor_Trustee_Relationship || ''})
Second Choice Successor Trustee:  ${data.Second_Choice_Successor_Trustee || ''} (${data.Second_Choice_Successor_Trustee_Relationship || ''})
Guardian Option:                  ${data.Guardian_Option || 'A'}
First Choice Guardian:            ${data.Guardian_Option === 'B' ? (data.First_Choice_Guardian || '') : 'Same as First Choice Successor Trustee'}
Backup Guardian:                  ${data.Guardian_Option === 'B' ? (data.Backup_Guardian || '') : 'Same as Second Choice Successor Trustee'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BENEFICIARIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Children:          ${data.Full_Legal_Names_of_Children || 'None listed'}
Children DOBs:     ${data.Children_DOBs || ''}
Distribution:      ${data.Distribution_Type || 'Equal'}
Percentages:       ${data.Distribution_Percentages || 'N/A'}
Inheritance Age:   ${data.Inheritance_Age || 'Not specified'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POWERS OF ATTORNEY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Financial Agent (Primary):  ${data.Financial_Agent_Primary || ''} (${data.Financial_Agent_Primary_Relationship || ''})
Financial Agent (Backup):   ${data.Financial_Agent_Backup || ''} (${data.Financial_Agent_Backup_Relationship || ''})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HEALTHCARE DIRECTIVES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${clientName} Primary Agent:   ${spouseName} (automatic — spouse)
${clientName} Backup Agent:    ${data.Alternate_Agent_Name || ''} (${data.Alternate_Agent_Relationship || ''})
${clientName} Backup Address:  ${data.Alternate_Agent_Address || ''}, ${data.Alternate_Agent_City || ''}, ${data.Alternate_Agent_State || ''} ${data.Alternate_Agent_Zip || ''}
${clientName} Backup Phone:    ${data.Alternate_Agent_Cell_Phone || ''}

${spouseName} Primary Agent:   ${clientName} (automatic — spouse)
${spouseName} Backup Agent:    ${data.Spouse2_Alternate_Agent_Name || ''} (${data.Spouse2_Alternate_Agent_Relationship || ''})
${spouseName} Backup Address:  ${data.Spouse2_Alternate_Agent_Address || ''}, ${data.Spouse2_Alternate_Agent_City || ''}, ${data.Spouse2_Alternate_Agent_State || ''} ${data.Spouse2_Alternate_Agent_Zip || ''}
${spouseName} Backup Phone:    ${data.Spouse2_Alternate_Agent_Cell_Phone || ''}

Medical Research — ${clientName}:  ${data.Medical_Research_Spouse1 || 'Not answered'} (client to initial at signing)
Medical Research — ${spouseName}:  ${data.Medical_Research_Spouse2 || 'Not answered'} (client to initial at signing)
Organ Donation — ${clientName}:    ${data.Organ_Donation_Spouse1 || 'Not answered'} (client to initial at signing)
Organ Donation — ${spouseName}:    ${data.Organ_Donation_Spouse2 || 'Not answered'} (client to initial at signing)
Living Will — ${clientName}:       Option ${data.Living_Will_Spouse1 || 'Not selected'} (client to initial at signing)
Living Will — ${spouseName}:       Option ${data.Living_Will_Spouse2 || 'Not selected'} (client to initial at signing)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATTORNEY FLAGS — ACTION REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${flags}

Draft document attached: ${filename}
— Flex Legal Services Attorneys Intake System
  `.trim();

  await transporter.sendMail({
    from: `"Flex Legal Intake" <${GMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `[INTAKE] ${clientName} & ${spouseName} — Joint Trust — Review Required`,
    text: emailBody,
    attachments: [{
      filename,
      content: docBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }]
  });

  console.log(`Email sent: ${clientName} — ${filename}`);
}

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Flex Legal intake server running on port ${PORT}`));
