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

COLLECT THESE FIELDS in a natural conversational order:
- Trust_Type: "Joint Marital Trust" or "Single Person Trust" (ask marital status first)
- Your_First_Name
- Your_Last_Name
- Your_Birth_Date (MM/DD/YYYY format)
- Your_Preferred_Signature_Name (how they sign their name — usually First Last)
- Your_Cell_Phone
- Your_Work_Phone_Number (say "enter N/A if none")
- Address
- City
- State (default Utah unless they say otherwise)
- Zip_Code
- County (Utah county — e.g. Utah County, Salt Lake County)
- Spouse_First_Name (joint trust only)
- Spouse_Birth_Date (joint trust only, MM/DD/YYYY)
- Spouses_Preferred_Signature_Name (joint trust only)
- Spouse_Cell_Phone (joint trust only)
- Spouse_Work_Phone_Number (joint trust only, "N/A if none")
- Full_Legal_Names_of_Children (comma-separated full legal names, or "None" if no children)
- Name_of_Trust (always "[Last Name] Family Trust" — generate this automatically, confirm with client)
- First_Choice_Successor_Trustee (full name of first choice trustee after both spouses pass)
- Second_Choice_Successor_Trustee (full name of backup trustee)
- Alternate_Agent_Name (healthcare agent — person who makes medical decisions if incapacitated)
- Alternate_Agent_Address
- Alternate_Agent_City
- Alternate_Agent_State
- Alternate_Agent_Zip
- Alternate_Agent_Cell_Phone
- Alternate_Agent_Work_Phone (N/A if none)

CONVERSATION RULES:
1. Ask ONE question at a time — never multiple questions in one message
2. Be warm, clear, and reassuring — many clients are nervous about estate planning
3. After collecting a name, use it naturally in follow-up messages
4. Group related questions logically (personal info → spouse → children → trust → trustees → healthcare agent)
5. For the trust name, tell the client: "Based on your name, we'll call your trust the [Last Name] Family Trust — does that work for you?"
6. If a client seems confused, offer a brief plain-language explanation
7. Never give legal advice — if they ask legal questions, say "Flex Legal Services Attorneys will review everything and can answer that at your signing appointment"
8. When you have collected ALL fields above, write a final warm closing message, then on a new line write exactly: [INTAKE_COMPLETE] followed by a JSON object with all collected fields

EXAMPLE COMPLETION FORMAT:
Thank you so much — that's everything we need. Our team will prepare your draft documents and be in touch within 1–2 business days. We look forward to helping protect your family.
[INTAKE_COMPLETE]
{"Trust_Type":"Joint Marital Trust","Your_First_Name":"James","Your_Last_Name":"Sullivan","Your_Birth_Date":"04/15/1978","Your_Preferred_Signature_Name":"James R. Sullivan","Your_Cell_Phone":"801-555-1234","Your_Work_Phone_Number":"N/A","Address":"123 Main St","City":"Provo","State":"Utah","Zip_Code":"84601","County":"Utah County","Spouse_First_Name":"Sarah","Spouse_Birth_Date":"07/22/1980","Spouses_Preferred_Signature_Name":"Sarah M. Sullivan","Spouse_Cell_Phone":"801-555-5678","Spouse_Work_Phone_Number":"N/A","Full_Legal_Names_of_Children":"Emma Grace Sullivan, Noah James Sullivan","Name_of_Trust":"Sullivan Family Trust","First_Choice_Successor_Trustee":"Michael Robert Sullivan","Second_Choice_Successor_Trustee":"Patricia Ann Jones","Alternate_Agent_Name":"Michael Robert Sullivan","Alternate_Agent_Address":"456 Oak Ave","Alternate_Agent_City":"Orem","Alternate_Agent_State":"Utah","Alternate_Agent_Zip":"84097","Alternate_Agent_Cell_Phone":"801-555-9999","Alternate_Agent_Work_Phone":"N/A"}`;

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
      max_tokens: 1000,
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
      max_tokens: 1000,
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
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
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
    Alternate_Agent_Name:             data.Alternate_Agent_Name || '',
    Alternate_Agent_Address:          data.Alternate_Agent_Address || '',
    Alternate_Agent_City:             data.Alternate_Agent_City || '',
    Alternate_Agent_State:            data.Alternate_Agent_State || '',
    Alternate_Agent_Zip:              data.Alternate_Agent_Zip || '',
    Alternate_Agent_Cell_Phone:       data.Alternate_Agent_Cell_Phone || '',
    Alternate_Agent_Work_Phone:       data.Alternate_Agent_Work_Phone || 'N/A',
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
HEALTHCARE AGENT: ${data.Alternate_Agent_Name || ''}

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
