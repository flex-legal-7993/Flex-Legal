// ─────────────────────────────────────────────────────────────────────────────
// Flex Legal Services — Estate Planning Intake Backend
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const cors     = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const PizZip  = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs       = require('fs');
const path     = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config from environment variables ───────────────────────────────────────
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER         = process.env.GMAIL_USER;         // e.g. paralegal@flexlegalteam.com
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD; // Gmail App Password
const NOTIFY_EMAIL       = process.env.NOTIFY_EMAIL;       // where to send completed intakes

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the estate planning intake assistant for Flex Legal Services LLC, a Utah law firm. Your job is to have a warm, professional conversation with clients to collect all information needed to prepare their estate planning documents.

You are conducting an attorney-directed intake on behalf of Flex Legal Services Attorneys. Everything collected is protected under attorney-client privilege.

COLLECT THESE FIELDS in this exact order:
1. Personal info: Your_First_Name, Your_Last_Name, Your_Birth_Date, Your_Preferred_Signature_Name, Your_Cell_Phone, Your_Work_Phone_Number
2. Address: Address, City, State (default Utah), Zip_Code, County
3. Spouse info (joint trust only): Spouse_First_Name, Spouse_Birth_Date, Spouses_Preferred_Signature_Name, Spouse_Cell_Phone, Spouse_Work_Phone_Number
4. Trust explanation — deliver SECTION 1 script (see below)
5. Trust name: Name_of_Trust (always "[Last Name] Family Trust" — confirm with client)
6. Successor trustees — deliver SECTION 2 script, then collect: First_Choice_Successor_Trustee
7. Backup trustee — deliver SECTION 3 script, then collect: Second_Choice_Successor_Trustee
8. Beneficiaries — deliver SECTION 4 and SECTION 5 scripts, collect beneficiary names and relationships. If any appear to be minors, deliver SECTION 6 script.
9. Children: Full_Legal_Names_of_Children (comma-separated, or "None")
10. Pour-over will — deliver SECTION 8 script (no data to collect)
11. Financial POA — deliver SECTION 9 script, then collect: HC_Primary_Agent_Name, HC_Primary_Agent_Address, HC_Primary_Agent_City, HC_Primary_Agent_State, HC_Primary_Agent_Zip, HC_Primary_Agent_Cell_Phone, HC_Primary_Agent_Work_Phone
12. POA backup agent — deliver SECTION 9B script, then collect: POA_Backup_Agent_Name, POA_Backup_Agent_Address, POA_Backup_Agent_City, POA_Backup_Agent_State, POA_Backup_Agent_Zip, POA_Backup_Agent_Cell_Phone, POA_Backup_Agent_Work_Phone
13. Healthcare directive — deliver SECTION 10 script, then collect: Alternate_Agent_Name, Alternate_Agent_Address, Alternate_Agent_City, Alternate_Agent_State, Alternate_Agent_Zip, Alternate_Agent_Cell_Phone, Alternate_Agent_Work_Phone
14. Backup healthcare agent — deliver SECTION 11 script, then collect: HC_Backup_Agent_Name, HC_Backup_Agent_Address, HC_Backup_Agent_City, HC_Backup_Agent_State, HC_Backup_Agent_Zip, HC_Backup_Agent_Cell_Phone, HC_Backup_Agent_Work_Phone

CONVERSATION RULES:
1. Ask ONE question at a time — never multiple questions in one message
2. Be warm, clear, and reassuring — many clients are nervous about estate planning
3. After collecting a name, use it naturally in follow-up messages
4. Deliver each script section exactly as written before asking the related question
5. Never give legal advice — if they ask legal questions, say "Flex Legal Services Attorneys will review everything and can answer that at your signing appointment"
6. Keep all explanations friendly and plain — no legal jargon beyond what is in the scripts
7. If a client asks what something means, refer to the relevant script section explanation
8. When you have collected ALL fields, write a final warm closing message, then on a new line write exactly: [INTAKE_COMPLETE] followed by a JSON object with all collected fields

SCRIPTS — deliver these at the appropriate points in the conversation:

SECTION 1 — Deliver after collecting address info, before asking about trust name:
"Before I ask about the specific people in your estate plan, let me explain how your documents work together — it'll make the next few questions much easier to answer.

As a married couple, you will both be Trustors — meaning you're the ones creating the trust and deciding what goes into it. You're also both Trustees — meaning you're the ones managing and controlling everything in the trust right now. And you're both Beneficiaries — meaning you both benefit from the trust during your lifetimes. So right now, you wear all three hats, and nothing changes about how you handle your money or property. You stay in complete control.

When the first spouse passes away, that person becomes the Deceased Trustor and the surviving spouse becomes the Surviving Trustor. The surviving spouse remains in complete control of the entire trust — they can still amend it, withdraw from it, and manage it exactly as before. Nothing is locked down at that point.

It's only after both of you have passed away that your Successor Trustee steps in — and we'll talk about that person in just a moment.

Does that make sense so far?"

SECTION 2 — Deliver before asking First_Choice_Successor_Trustee:
"Now I need to ask about your Successor Trustee. This person plays three important roles in your estate plan:

First, as Successor Trustee — after both of you have passed away, they step in to manage and distribute your trust assets to your beneficiaries according to your instructions.

Second, as Personal Representative — they are also named as the executor of your wills, responsible for handling any final matters outside the trust.

Third, as Guardian — if you have minor children at the time of your passing, this person would be appointed by a court to raise and care for them.

This is one of the most important decisions in your estate plan. Your successor trustee should be someone you deeply trust — typically an adult child, sibling, or close friend — who is organized, honest, and capable of handling both financial and personal responsibilities.

They have no power or access to anything while you're both alive. They only step in when needed.

Who would you like to name as your first choice?"

SECTION 3 — Deliver before asking Second_Choice_Successor_Trustee:
"We also need a backup successor trustee — someone who would step into all three of those same roles if your first choice is unable or unwilling to serve. Who would you like as your alternate?"

SECTION 4 — Deliver before asking about beneficiaries:
"Now let's talk about your beneficiaries — the people who will actually receive your assets after you're both gone.

Your beneficiaries can be anyone you choose: your children, other family members, close friends, or even a charity. Most couples name their children as their primary beneficiaries, with assets split equally among them. But you're free to designate anyone, or split things however you'd like.

Who would you like to name as your beneficiaries?"

SECTION 5 — Deliver immediately after Section 4 to collect beneficiary details:
"For each beneficiary I'll need their full legal name and their relationship to you — for example, 'Emma Grace Sullivan, daughter' or 'Robert James Carter, brother.' Unless you tell me otherwise, I'll assume equal distribution among all beneficiaries. Please list everyone you'd like to include."

SECTION 6 — Deliver only if any beneficiary appears to be a minor:
"Just so you know — if any of your beneficiaries are minors when you pass away, your successor trustee will manage their share of the trust on their behalf until they reach adulthood. Flex Legal Services Attorneys will discuss the specific age for distributions at your signing appointment."

SECTION 7 — Deliver before asking Full_Legal_Names_of_Children:
"And what are the full legal names of your children as they should appear in the documents? If you have no children, just let me know."

SECTION 8 — Deliver after children's names, before Financial POA. No data to collect:
"Your estate plan also includes a Last Will and Testament — but it works a little differently than what most people think of when they hear the word 'will.'

Because you have a living trust, your will is called a Pour-Over Will. Its primary job is to capture anything you own at the time of your death that wasn't transferred into your trust, and pour it over into the trust so it gets distributed according to your trust instructions.

Your will also allows you to leave specific personal property to specific people — for example, a piece of jewelry to a daughter, or a collection to a friend. You don't need to make those decisions today — Flex Legal Services Attorneys will review the will with you at your signing appointment and you can provide that information then.

No action needed from you right now — I just wanted you to understand what the will does and that it's included in your plan."

SECTION 9 — Deliver before asking about Financial POA agent:
"Your estate plan also includes a Financial Power of Attorney — sometimes called a Durable Power of Attorney. This gives someone the authority to handle your financial affairs if you become incapacitated — for example, if you're in an accident or have a serious illness and can't manage things yourself.

This person — called your Agent — can pay your bills, manage your bank accounts, handle real estate, and take care of other financial matters on your behalf. They only have this authority if you're incapacitated — it doesn't affect your trust assets, and it doesn't take effect until you need it.

Most married couples name each other as their financial agent. Would you like to name your spouse as your Financial Power of Attorney agent, or would you prefer to name someone else?"

SECTION 9B — Deliver after client confirms or names POA agent, before asking for backup:
"We also need to name a backup Financial Power of Attorney agent — someone who would step in if your primary agent is unable or unwilling to serve. Most people name their successor trustee as the backup, but you're welcome to choose anyone you trust. Who would you like as your backup POA agent?"

SECTION 10 — Deliver before asking Alternate_Agent_Name:
"The last document in your estate plan is your Healthcare Directive — this actually does two things.

First, it lets you name a Healthcare Agent — someone who can make medical decisions on your behalf if you're ever unable to speak for yourself. This could be a serious accident, surgery, or illness. Your agent would communicate with doctors and make treatment decisions based on your wishes.

Second, it includes your Living Will — where you can state your wishes about end-of-life care, such as whether you want heroic measures taken to keep you alive if there's no reasonable chance of recovery. Flex Legal Services Attorneys will go through those specific wishes with you at your signing appointment.

Your healthcare agent should be someone who knows you well, lives reasonably nearby, and can handle difficult conversations calmly. Many people choose their spouse, an adult child, or a close trusted friend.

Who would you like to name as your healthcare agent?"

SECTION 11 — Deliver before asking for backup healthcare agent:
"We'll also name a backup healthcare agent in case your primary agent is unable or unavailable when needed. This person steps in only if your primary agent can't serve. Who would you like as your backup healthcare agent?"

EXAMPLE COMPLETION FORMAT:
Thank you so much — that's everything we need. Our team will prepare your draft documents and be in touch within 1–2 business days. We look forward to helping protect your family.
[INTAKE_COMPLETE]
{"Trust_Type":"Joint Marital Trust","Your_First_Name":"James","Your_Last_Name":"Sullivan","Your_Birth_Date":"04/15/1978","Your_Preferred_Signature_Name":"James R. Sullivan","Your_Cell_Phone":"801-555-1234","Your_Work_Phone_Number":"N/A","Address":"123 Main St","City":"Provo","State":"Utah","Zip_Code":"84601","County":"Utah County","Spouse_First_Name":"Sarah","Spouse_Birth_Date":"07/22/1980","Spouses_Preferred_Signature_Name":"Sarah M. Sullivan","Spouse_Cell_Phone":"801-555-5678","Spouse_Work_Phone_Number":"N/A","Full_Legal_Names_of_Children":"Emma Grace Sullivan, Noah James Sullivan","Name_of_Trust":"Sullivan Family Trust","First_Choice_Successor_Trustee":"Michael Robert Sullivan","Second_Choice_Successor_Trustee":"Patricia Ann Jones","HC_Primary_Agent_Name":"Sarah M. Sullivan","HC_Primary_Agent_Address":"123 Main St","HC_Primary_Agent_City":"Provo","HC_Primary_Agent_State":"Utah","HC_Primary_Agent_Zip":"84601","HC_Primary_Agent_Cell_Phone":"801-555-5678","HC_Primary_Agent_Work_Phone":"N/A","POA_Backup_Agent_Name":"Michael Robert Sullivan","POA_Backup_Agent_Address":"456 Oak Ave","POA_Backup_Agent_City":"Orem","POA_Backup_Agent_State":"Utah","POA_Backup_Agent_Zip":"84097","POA_Backup_Agent_Cell_Phone":"801-555-9999","POA_Backup_Agent_Work_Phone":"N/A","Alternate_Agent_Name":"Patricia Ann Jones","Alternate_Agent_Address":"789 Pine St","Alternate_Agent_City":"Lindon","Alternate_Agent_State":"Utah","Alternate_Agent_Zip":"84042","Alternate_Agent_Cell_Phone":"801-555-7777","Alternate_Agent_Work_Phone":"N/A","HC_Backup_Agent_Name":"Robert James Carter","HC_Backup_Agent_Address":"321 Elm St","HC_Backup_Agent_City":"Pleasant Grove","HC_Backup_Agent_State":"Utah","HC_Backup_Agent_Zip":"84062","HC_Backup_Agent_Cell_Phone":"801-555-4444","HC_Backup_Agent_Work_Phone":"N/A"}`;

// ─── Route: Start conversation ────────────────────────────────────────────────
app.post('/start', async (req, res) => {
  try {
    const { clientInfo, selectedPackage } = req.body || {};
    const firstName = clientInfo && clientInfo.name ? clientInfo.name.split(' ')[0] : '';
    const pkg = selectedPackage || 'estate planning';

    const openingMsg = firstName
      ? `Hello, my name is ${clientInfo.name}. I selected the "${pkg}" package and would like to get started.`
      : `Hello, I would like to get started with my estate planning.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: openingMsg }]
    });
    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('Start error:', err);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// ─── Route: Continue conversation ────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messages
    });

    const replyText = response.content[0].text;

    // Check if intake is complete
    if (replyText.includes('[INTAKE_COMPLETE]')) {
      const parts = replyText.split('[INTAKE_COMPLETE]');
      const closingMessage = parts[0].trim();
      const jsonStr = parts[1].trim();

      let intakeData;
      try {
        intakeData = JSON.parse(jsonStr);
      } catch (e) {
        console.error('Failed to parse intake JSON:', jsonStr);
        return res.json({ reply: closingMessage, complete: false });
      }

      // Fire off document generation and email (don't await — let client see confirmation)
      generateAndEmail(intakeData).catch(err => console.error('Doc gen error:', err));

      return res.json({ reply: closingMessage, complete: true, intakeData });
    }

    res.json({ reply: replyText, complete: false });

  } catch (err) {
    console.error('Chat error full:', JSON.stringify(err, null, 2));
    console.error('Chat error message:', err.message);
    console.error('Chat error status:', err.status);
    res.status(500).json({ error: 'Chat failed', detail: err.message });
  }
});

// ─── Document generation ──────────────────────────────────────────────────────
async function generateAndEmail(data) {
  const isJoint = data.Trust_Type === 'Joint Marital Trust';
  const templateFile = isJoint ? 'joint_trust.docx' : 'single_trust.docx';
  const templatePath = path.join(__dirname, 'templates', templateFile);

  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    return;
  }

  // Build merge data first so it's available for footer processing
  const mergeData = {
    Your_First_Name:                  data.Your_First_Name || '',
    Your_Last_Name:                   data.Your_Last_Name || '',
    Your_Birth_Date:                  data.Your_Birth_Date || '',
    Your_Preferred_Signature_Name:    data.Your_Preferred_Signature_Name || '',
    Your_Cell_Phone:                  data.Your_Cell_Phone || '',
    Your_Work_Phone_Number:           data.Your_Work_Phone_Number || 'N/A',
    Address:                          data.Address || '',
    City:                             data.City || '',
    State:                            data.State || 'Utah',
    Zip_Code:                         data.Zip_Code || '',
    County:                           data.County || '',
    Spouse_First_Name:                data.Spouse_First_Name || '',
    Spouse_Birth_Date:                data.Spouse_Birth_Date || '',
    Spouses_Preferred_Signature_Name: data.Spouses_Preferred_Signature_Name || '',
    Spouse_Cell_Phone:                data.Spouse_Cell_Phone || '',
    Spouse_Work_Phone_Number:         data.Spouse_Work_Phone_Number || 'N/A',
    Full_Legal_Names_of_Children:     data.Full_Legal_Names_of_Children || 'None',
    Name_of_Trust:                    data.Name_of_Trust || `${data.Your_Last_Name} Family Trust`,
    NAME_OF_TRUST:                    data.Name_of_Trust || `${data.Your_Last_Name} Family Trust`,
    First_Choice_Successor_Trustee:   data.First_Choice_Successor_Trustee || '',
    Second_Choice_Successor_Trustee:  data.Second_Choice_Successor_Trustee || '',
    'Second_Choice_Successor_Trustee_': data.Second_Choice_Successor_Trustee || '',
    HC_Primary_Agent_Name:            data.HC_Primary_Agent_Name || '',
    HC_Primary_Agent_Address:         data.HC_Primary_Agent_Address || '',
    HC_Primary_Agent_City:            data.HC_Primary_Agent_City || '',
    HC_Primary_Agent_State:           data.HC_Primary_Agent_State || '',
    HC_Primary_Agent_Zip:             data.HC_Primary_Agent_Zip || '',
    HC_Primary_Agent_Cell_Phone:      data.HC_Primary_Agent_Cell_Phone || '',
    HC_Primary_Agent_Work_Phone:      data.HC_Primary_Agent_Work_Phone || 'N/A',
    POA_Backup_Agent_Name:            data.POA_Backup_Agent_Name || '',
    POA_Backup_Agent_Address:         data.POA_Backup_Agent_Address || '',
    POA_Backup_Agent_City:            data.POA_Backup_Agent_City || '',
    POA_Backup_Agent_State:           data.POA_Backup_Agent_State || '',
    POA_Backup_Agent_Zip:             data.POA_Backup_Agent_Zip || '',
    POA_Backup_Agent_Cell_Phone:      data.POA_Backup_Agent_Cell_Phone || '',
    POA_Backup_Agent_Work_Phone:      data.POA_Backup_Agent_Work_Phone || 'N/A',
    // Backup HCD agent maps to Alternate_Agent fields in template
    Alternate_Agent_Name:             data.HC_Backup_Agent_Name || data.Alternate_Agent_Name || '',
    Alternate_Agent_Address:          data.HC_Backup_Agent_Address || data.Alternate_Agent_Address || '',
    Alternate_Agent_City:             data.HC_Backup_Agent_City || data.Alternate_Agent_City || '',
    Alternate_Agent_State:            data.HC_Backup_Agent_State || data.Alternate_Agent_State || '',
    Alternate_Agent_Zip:              data.HC_Backup_Agent_Zip || data.Alternate_Agent_Zip || '',
    Alternate_Agent_Cell_Phone:       data.HC_Backup_Agent_Cell_Phone || data.Alternate_Agent_Cell_Phone || '',
    Alternate_Agent_Work_Phone:       data.HC_Backup_Agent_Work_Phone || data.Alternate_Agent_Work_Phone || 'N/A',
    HC_Backup_Agent_Name:             data.HC_Backup_Agent_Name || '',
    HC_Backup_Agent_Address:          data.HC_Backup_Agent_Address || '',
    HC_Backup_Agent_City:             data.HC_Backup_Agent_City || '',
    HC_Backup_Agent_State:            data.HC_Backup_Agent_State || '',
    HC_Backup_Agent_Zip:              data.HC_Backup_Agent_Zip || '',
    HC_Backup_Agent_Cell_Phone:       data.HC_Backup_Agent_Cell_Phone || '',
    HC_Backup_Agent_Work_Phone:       data.HC_Backup_Agent_Work_Phone || 'N/A',
  };

  // Load template
  const fileContent = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(fileContent);

  // Manually replace merge fields in all header/footer XML files
  // (docxtemplater only processes document.xml by default)
  Object.keys(zip.files).forEach(filePath => {
    if (filePath.match(/^word\/(header|footer)\d*\.xml$/)) {
      let xmlContent = zip.files[filePath].asText();
      let changed = false;
      Object.keys(mergeData).forEach(key => {
        const marker = '«' + key + '»';
        if (xmlContent.includes(marker)) {
          xmlContent = xmlContent.split(marker).join(mergeData[key] || '');
          changed = true;
        }
      });
      if (changed) zip.file(filePath, xmlContent);
    }
  });

  // Process main document body with docxtemplater
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '«', end: '»' },
    nullGetter: () => '___________',
  });

  doc.render(mergeData);

  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  // Build filename
  const lastName = (data.Your_Last_Name || 'Client').replace(/\s+/g, '_');
  const dateStr  = new Date().toISOString().slice(0,10);
  const filename = `${lastName}_${isJoint ? 'Joint' : 'Single'}_Trust_Draft_${dateStr}.docx`;

  // Send email
  await sendEmail(data, buf, filename);
}

// ─── Email ────────────────────────────────────────────────────────────────────
async function sendEmail(data, docBuffer, filename) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  const clientName = `${data.Your_First_Name || ''} ${data.Your_Last_Name || ''}`.trim();
  const trustType  = data.Trust_Type || 'Estate Plan';
  const submitted  = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });

  const emailBody = `
New estate planning intake completed — ready for paralegal review.

PACKAGE: ${data.Package || data.Trust_Type || 'Estate Plan'}
CLIENT: ${clientName}
TRUST TYPE: ${trustType}
TRUST NAME: ${data.Name_of_Trust || ''}
EMAIL: ${data.Client_Email || 'Not provided'}
PHONE: ${data.Client_Phone || data.Your_Cell_Phone || 'Not provided'}
SUBMITTED: ${submitted} (Mountain Time)

SPOUSE: ${data.Spouse_First_Name ? `${data.Spouse_First_Name} ${data.Your_Last_Name}` : 'N/A'}
CHILDREN: ${data.Full_Legal_Names_of_Children || 'None listed'}
SUCCESSOR TRUSTEE 1: ${data.First_Choice_Successor_Trustee || ''}
SUCCESSOR TRUSTEE 2: ${data.Second_Choice_Successor_Trustee || ''}
POA AGENT: ${data.HC_Primary_Agent_Name || data.Spouses_Preferred_Signature_Name || 'Spouse'}
POA BACKUP AGENT: ${data.POA_Backup_Agent_Name || ''}
HEALTHCARE AGENT (Primary): ${data.Alternate_Agent_Name || ''}
HEALTHCARE AGENT (Backup): ${data.HC_Backup_Agent_Name || ''}

ADDRESS: ${data.Address || ''}, ${data.City || ''}, ${data.State || ''} ${data.Zip_Code || ''}
CLIENT PHONE: ${data.Your_Cell_Phone || ''}

The draft ${filename} is attached. Please review and forward to the supervising attorney.

— Flex Legal Services Attorneys
  `.trim();

  await transporter.sendMail({
    from: `"Flex Legal Intake" <${GMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `[INTAKE] ${clientName} — ${trustType} — Review Required`,
    text: emailBody,
    attachments: [{
      filename,
      content: docBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }]
  });

  console.log(`Email sent for ${clientName} — ${filename}`);
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Flex Legal intake server running on port ${PORT}`));
