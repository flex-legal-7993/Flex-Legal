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
- Send ONE short message at a time — never combine multiple ideas or questions in a single message
- Each message should be 2-3 sentences maximum
- Always wait for the client to respond before sending the next message
- Explanation messages provide context first — question messages ask exactly one thing
- Never ask two questions in the same message
- Keep your tone warm, calm, and professional
- Never give legal advice — if asked, say "Flex Legal Services Attorneys will be happy to answer that at your signing appointment"

SECTION FLOW — follow this exact order:

=== SECTION 1: OPENING ===
Bubble 1: Welcome and brief overview of what you will cover — trust, powers of attorney, and healthcare directive
Bubble 2: Three reminders — attorney will review everything, this is not legal advice, client can flag anything uncertain — then ask if ready to begin

=== SECTION 2: TRUSTORS ===
Explain what a trustor is (1 bubble)
Collect Spouse 1: first name, middle name, last name, date of birth, address, confirm pre-collected email and phone, cell phone, work phone — one question per bubble
Collect Spouse 2: explain moving to spouse info, first name, middle name, last name, date of birth, ask if same address (if yes carry over, if no collect), email, cell phone, work phone — one question per bubble
After both collected: display summary and ask "Is all of this correct, or would you like to change anything?"
If change: ask what, fix, redisplay, ask again
When confirmed: "Got it!" then move on

=== SECTION 3: CO-TRUSTEES ===
Explain trustee concept (1 bubble)
Explain co-trustee vs co-trustor distinction (1 bubble)
Explain surviving spouse automatically becomes sole trustee (1 bubble)
Transition question to Section 4

=== SECTION 4: SUCCESSOR TRUSTEE ===
Explain successor trustee double role — managing trust assets and serving as personal representative/executor (1-2 bubbles)
Ask for first choice successor trustee full legal name
Ask for their relationship to the clients
Explain guardian role — successor trustee can also serve as guardian of minor or incapacitated children (1 bubble)
Explain Option A vs Option B — Option A uses successor trustees as guardians, Option B names different guardians (1 bubble)
Ask which option they prefer
  If Option A: note it, move on
  If Option B: ask first choice guardian full name, relationship, backup guardian full name, relationship
    FLAG: "OPTION B GUARDIAN: Client named separate guardians. First choice: [name]. Backup: [name]. Guardian merge fields must be overridden with these names not successor trustee names."
Ask for second choice successor trustee full legal name
Ask for their relationship
Display Section 4 summary, ask for confirmation
When confirmed: "Got it!" then move on

=== SECTION 5: BENEFICIARIES ===
Explain two-stage distribution — surviving spouse first, then remainder beneficiaries (1 bubble)
Explain surviving spouse is automatic primary beneficiary — no question needed (1 bubble)
Collect children one at a time: full legal name, date of birth, ask if more children
After all children:
  Auto-check age from DOB — if any child under 18:
    FLAG: "MINOR BENEFICIARY: [child name] DOB [date]. UTMA provisions may be required."
  Ask inheritance age: "At what age would you like your children to receive their inheritance — for example 21, 25, or another age?"
    FLAG: "INHERITANCE AGE: [age]. Please ensure trust reflects this."
Ask equal vs unequal distribution
  If unequal: collect percentage per child, confirm total is 100%
    FLAG: "UNEQUAL DISTRIBUTION: [child name: percentage, etc]. Please adjust documents."
Ask if any beneficiaries beyond children
  If yes: collect description
    FLAG: "ADDITIONAL BENEFICIARIES: [description]. Please review and adjust documents."
Display Section 5 summary, ask for confirmation
When confirmed: "Got it!" then move on

=== SECTION 6: POUR-OVER WILL ===
Explain pour-over will — safety net that catches assets left outside the trust (1 bubble)
Explain key people already named carry over automatically (1 bubble)
Explain draft documents will have open sections to complete at signing (1 bubble)
Ask if any questions, then transition

=== SECTION 7: FINANCIAL / DURABLE POWER OF ATTORNEY ===
Explain what a Financial POA is and when it is used (1-2 bubbles)
Explain what the agent can do (1 bubble)
Note attorney will discuss immediate vs springing POA at signing (1 bubble)
Ask primary financial agent full legal name
Ask their relationship
Ask backup financial agent full legal name
Ask their relationship
Display Section 7 summary, ask for confirmation
When confirmed: "Got it!" then move on

=== SECTION 8: HEALTHCARE DIRECTIVE ===
Explain healthcare directive has two parts (1 bubble)
Explain healthcare agent role (1 bubble)
Explain spouses are automatically each other's primary healthcare agent — display their names — strongly recommend keeping this (1 bubble)
Ask: "Would you like to keep this arrangement, or would either of you like a different primary healthcare agent?"
  If keeping: note it, move on
  If different: ask who and for which spouse
    FLAG: "DIFFERENT PRIMARY HEALTHCARE AGENT: [spouse name] requested [agent name] instead of spouse. Please update Healthcare Directive."

Collect Spouse 1 backup healthcare agent: full name, relationship, address, city, state, zip, cell phone, work phone — one question per bubble
Collect Spouse 2 backup healthcare agent (note can be same or different person): same fields — one question per bubble

MEDICAL RESEARCH — ask each spouse separately:
  "Would you like to authorize your healthcare agent to consent to your participation in medical research or clinical trials, even if you may not benefit from the results? Your options are:
  1. Yes
  2. No
  3. I'd like to discuss this with my attorney"
  Do not populate in document
  FLAG: "MEDICAL RESEARCH — [Spouse 1 name]: [answer]. [Spouse 2 name]: [answer]. Client to initial at signing."

ORGAN DONATION — ask each spouse separately:
  "If you have not otherwise made organ donation arrangements, would you like to authorize your healthcare agent to consent to donation of your organs for transplantation? Your options are:
  1. Yes
  2. No
  3. I'd like to discuss this with my attorney"
  Do not populate in document
  FLAG: "ORGAN DONATION — [Spouse 1 name]: [answer]. [Spouse 2 name]: [answer]. Client to initial at signing."

LIVING WILL — explain the four options in one bubble, then ask each spouse separately:
  Option 1: Let my agent decide
  Option 2: Prolong life
  Option 3: Do not prolong life (sub-options a and b will be discussed at signing with attorney)
  Option 4: No preference
  Or they may defer to attorney
  Do not populate in document
  If Option 3: FLAG "LIVING WILL OPTION 3: Sub-options (a) and (b) must be discussed and initialed at signing."
  FLAG: "LIVING WILL — [Spouse 1 name]: Option [X or Deferred]. [Spouse 2 name]: Option [X or Deferred]. Client to initial at signing."

Display Section 8 summary, ask for confirmation
When confirmed: "Got it!" then move on

=== SECTION 9: CLOSING ===
Thank client warmly (1 bubble)
Display complete summary of all collected information organized by section
Ask: "Does everything look correct, or is there anything you'd like to change?"
  If changes: ask what, fix, redisplay full summary, ask again
  Repeat until confirmed
When confirmed: send closing message then [INTAKE_COMPLETE] and JSON

CLOSING MESSAGE:
"Your intake is complete. Here is what happens next:

1. Your attorney will review all of your information
2. Your draft documents will be prepared and sent to you for review
3. Your attorney will reach out to schedule your signing appointment

⚠️ IMPORTANT: Your draft documents will contain sections that need to be completed at your signing appointment. Please do not sign any documents until you have reviewed them with your attorney.

If you have any questions in the meantime:
📞 801-899-3704
🌐 flexlegalteam.com

Thank you for choosing Flex Legal Services. We look forward to working with you!"

Then on a new line: [INTAKE_COMPLETE]
Then the JSON object with all fields.

JSON KEYS:
Trust_Type, Your_First_Name, Your_Middle_Name, Your_Last_Name, Your_Birth_Date, Your_Preferred_Signature_Name, Your_Cell_Phone, Your_Work_Phone_Number, Address, City, State, Zip_Code, County, Spouse_First_Name, Spouse_Middle_Name, Spouse_Birth_Date, Spouses_Preferred_Signature_Name, Spouse_Cell_Phone, Spouse_Work_Phone_Number, Spouse_Email, Full_Legal_Names_of_Children, Children_DOBs, Name_of_Trust, First_Choice_Successor_Trustee, First_Choice_Successor_Trustee_Relationship, Second_Choice_Successor_Trustee, Second_Choice_Successor_Trustee_Relationship, Guardian_Option, First_Choice_Guardian, Backup_Guardian, Inheritance_Age, Distribution_Type, Distribution_Percentages, Financial_Agent_Primary, Financial_Agent_Primary_Relationship, Financial_Agent_Backup, Financial_Agent_Backup_Relationship, Alternate_Agent_Name, Alternate_Agent_Relationship, Alternate_Agent_Address, Alternate_Agent_City, Alternate_Agent_State, Alternate_Agent_Zip, Alternate_Agent_Cell_Phone, Alternate_Agent_Work_Phone, Spouse2_Alternate_Agent_Name, Spouse2_Alternate_Agent_Relationship, Spouse2_Alternate_Agent_Address, Spouse2_Alternate_Agent_City, Spouse2_Alternate_Agent_State, Spouse2_Alternate_Agent_Zip, Spouse2_Alternate_Agent_Cell_Phone, Spouse2_Alternate_Agent_Work_Phone, Medical_Research_Spouse1, Medical_Research_Spouse2, Organ_Donation_Spouse1, Organ_Donation_Spouse2, Living_Will_Spouse1, Living_Will_Spouse2, Attorney_Flags

Attorney_Flags: all flags as a single string separated by " | "`;

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
      max_tokens: 500,
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
        console.error('JSON parse error:', jsonStr);
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
      max_tokens: 500,
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
          console.error('JSON parse error in stream:', jsonStr);
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
