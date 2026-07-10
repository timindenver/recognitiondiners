const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getPlainEnv(env, key) {
  return (env?.[key] || env?.[` ${key}`] || '').trim();
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPhone(phone) {
  return /^[0-9+()\-.\s]{7,25}$/.test(phone);
}

function isZipCode(zipCode) {
  return /^\d{5}(?:-\d{4})?$/.test(zipCode);
}

function cleanText(value) {
  return String(value || '').trim();
}

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sha256(input) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function formulaValue(value) {
  return String(value || '').replace(/'/g, "\\'");
}

async function airtableRequest({ apiKey, path, method = 'GET', body }) {
  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {}

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || `Airtable request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function findAirtableRecordByField({ apiKey, baseId, tableName, fieldName, value, selectedFieldName = fieldName }) {
  const formula = encodeURIComponent(`{${fieldName}}='${formulaValue(value)}'`);
  const path = `${baseId}/${encodeURIComponent(tableName)}?maxRecords=1&fields%5B%5D=${encodeURIComponent(selectedFieldName)}&filterByFormula=${formula}`;
  const payload = await airtableRequest({ apiKey, path });
  return payload?.records?.[0] || null;
}

async function findAirtableRecordByEmail({ apiKey, baseId, tableName, emailField, email }) {
  const formula = encodeURIComponent(`LOWER({${emailField}})='${formulaValue(email.toLowerCase())}'`);
  const path = `${baseId}/${encodeURIComponent(tableName)}?maxRecords=1&fields%5B%5D=${encodeURIComponent(emailField)}&filterByFormula=${formula}`;
  const payload = await airtableRequest({ apiKey, path });
  return payload?.records?.[0] || null;
}

function buildAirtableFields({
  emailField,
  firstNameField,
  lastNameField,
  phoneField,
  groupSizeField,
  zipCodeField,
  sourceField,
  sourceValue,
  createdAtField,
  verificationStatusField,
  verificationTokenHashField,
  verificationRequestedAtField,
  verifiedAtField,
  email,
  firstName,
  lastName,
  phone,
  groupSize,
  zipCode,
  verificationStatus,
  verificationTokenHash,
  verificationRequestedAt,
  verifiedAt,
}) {
  const fields = {
    [emailField]: email,
    [firstNameField]: firstName,
    [lastNameField]: lastName,
    [phoneField]: phone,
    [groupSizeField]: groupSize,
    [zipCodeField]: zipCode,
  };

  if (sourceField && sourceValue) fields[sourceField] = sourceValue;
  if (createdAtField && verificationRequestedAt) fields[createdAtField] = verificationRequestedAt;
  if (verificationStatusField) fields[verificationStatusField] = verificationStatus;
  if (verificationTokenHashField) fields[verificationTokenHashField] = verificationTokenHash || '';
  if (verificationRequestedAtField && verificationRequestedAt) fields[verificationRequestedAtField] = verificationRequestedAt;
  if (verifiedAtField) fields[verifiedAtField] = verifiedAt || null;

  return fields;
}

async function createAirtableRecord({ apiKey, baseId, tableName, fields }) {
  return airtableRequest({
    apiKey,
    path: `${baseId}/${encodeURIComponent(tableName)}`,
    method: 'POST',
    body: {
      records: [{ fields }],
      typecast: true,
    },
  });
}

async function updateAirtableRecord({ apiKey, baseId, tableName, recordId, fields }) {
  return airtableRequest({
    apiKey,
    path: `${baseId}/${encodeURIComponent(tableName)}/${recordId}`,
    method: 'PATCH',
    body: {
      typecast: true,
      fields,
    },
  });
}

function verificationEmail({ verifyUrl, email }) {
  const safeEmail = htmlEscape(email);
  const subject = 'Confirm your Recognition Dinners signup';
  const text = `Almost in. Click this link to confirm your Recognition Dinners signup: ${verifyUrl}\n\nIf you did not request this, you can ignore this email.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#14181F;max-width:640px;margin:auto;padding:32px;background:#F5F1E8">
      <div style="background:#14181F;border:1px solid rgba(20,24,31,0.14);border-radius:16px;padding:32px;color:#F5F1E8;box-shadow:0 20px 40px -24px rgba(0,0,0,0.35)">
        <div style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#C9A24B;margin-bottom:18px">Recognition Dinners</div>
        <h1 style="font-family:Fraunces,Georgia,serif;font-size:36px;line-height:1.08;font-weight:450;margin:0 0 14px;color:#F5F1E8">Almost in.</h1>
        <p style="margin:0 0 20px;font-size:16px;color:#DCD6C6">We just need to confirm <strong style="color:#F5F1E8">${safeEmail}</strong> before we add you to the invite-only list.</p>
        <p style="margin:0 0 28px"><a href="${verifyUrl}" style="display:inline-block;background:#C9A24B;color:#14181F;text-decoration:none;padding:14px 22px;border-radius:6px;font-weight:700">Confirm my email</a></p>
        <div style="padding-top:18px;border-top:1px dashed rgba(245,241,232,0.26);font-size:13px;color:#DCD6C6">If you didn’t request this, you can safely ignore this email.</div>
      </div>
    </div>`;
  return { subject, text, html };
}

async function sendEmail(env, { to, subject, text, html }) {
  const apiKey = getPlainEnv(env, 'RESEND_API_KEY');
  const from = getPlainEnv(env, 'FROM_EMAIL') || getPlainEnv(env, 'RESEND_FROM_EMAIL');
  if (!apiKey || !from) {
    const error = new Error('Email confirmation is not configured.');
    error.status = 500;
    throw error;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Email provider error: ${response.status} ${body}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export async function onRequestPost({ request, env }) {
  try {
    const apiKey = getPlainEnv(env, 'AIRTABLE_API_KEY');
    const baseId = getPlainEnv(env, 'AIRTABLE_BASE_ID');
    const tableName = getPlainEnv(env, 'AIRTABLE_TABLE_NAME');
    const emailField = getPlainEnv(env, 'AIRTABLE_EMAIL_FIELD') || 'Email';
    const firstNameField = getPlainEnv(env, 'AIRTABLE_FIRST_NAME_FIELD') || 'First Name';
    const lastNameField = getPlainEnv(env, 'AIRTABLE_LAST_NAME_FIELD') || 'Last Name';
    const phoneField = getPlainEnv(env, 'AIRTABLE_PHONE_FIELD') || 'Best Contact Number';
    const groupSizeField = getPlainEnv(env, 'AIRTABLE_GROUP_SIZE_FIELD') || 'Estimated Group Size';
    const zipCodeField = getPlainEnv(env, 'AIRTABLE_ZIP_CODE_FIELD') || 'Preferred Zip Code';
    const sourceField = getPlainEnv(env, 'AIRTABLE_SOURCE_FIELD');
    const sourceValue = getPlainEnv(env, 'AIRTABLE_SOURCE_VALUE') || 'recognitiondinners.com';
    const createdAtField = getPlainEnv(env, 'AIRTABLE_CREATED_AT_FIELD');
    const verificationStatusField = getPlainEnv(env, 'AIRTABLE_VERIFICATION_STATUS_FIELD') || 'Verification Status';
    const verificationTokenHashField = getPlainEnv(env, 'AIRTABLE_VERIFICATION_TOKEN_HASH_FIELD') || 'Verification Token Hash';
    const verificationRequestedAtField = getPlainEnv(env, 'AIRTABLE_VERIFICATION_REQUESTED_AT_FIELD') || 'Verification Requested At';
    const verifiedAtField = getPlainEnv(env, 'AIRTABLE_VERIFIED_AT_FIELD') || 'Verified At';

    if (!apiKey || !baseId || !tableName) {
      return json({ ok: false, error: 'Signup is not configured yet.' }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const firstName = cleanText(body?.firstName);
    const lastName = cleanText(body?.lastName);
    const phone = cleanText(body?.phone);
    const groupSize = cleanText(body?.groupSize);
    const zipCode = cleanText(body?.zipCode);
    const email = cleanText(body?.email).toLowerCase();

    if (!firstName || !lastName || !phone || !groupSize || !zipCode) {
      return json({ ok: false, error: 'Please complete every field.' }, 400);
    }

    if (!isEmail(email)) {
      return json({ ok: false, error: 'Please enter a valid email.' }, 400);
    }

    if (!isPhone(phone)) {
      return json({ ok: false, error: 'Please enter a valid contact number.' }, 400);
    }

    if (!['6-10', '10-16', '16 or more'].includes(groupSize)) {
      return json({ ok: false, error: 'Please choose an estimated group size.' }, 400);
    }

    if (!isZipCode(zipCode)) {
      return json({ ok: false, error: 'Please enter a valid zip code.' }, 400);
    }

    const nowIso = new Date().toISOString();
    const verificationEnabled = Boolean(getPlainEnv(env, 'RESEND_API_KEY') && (getPlainEnv(env, 'FROM_EMAIL') || getPlainEnv(env, 'RESEND_FROM_EMAIL')));
    const existing = await findAirtableRecordByEmail({
      apiKey,
      baseId,
      tableName,
      emailField,
      email,
    });
    const existingStatus = cleanText(existing?.fields?.[verificationStatusField]).toLowerCase();

    if (verificationEnabled && existingStatus === 'confirmed') {
      return json({ ok: true, alreadyConfirmed: true, message: 'That email is already confirmed. You’re already on the list.' });
    }

    if (verificationEnabled) {
      const token = await makeToken();
      const tokenHash = await sha256(token);
      const fields = buildAirtableFields({
        emailField,
        firstNameField,
        lastNameField,
        phoneField,
        groupSizeField,
        zipCodeField,
        sourceField,
        sourceValue,
        createdAtField,
        verificationStatusField,
        verificationTokenHashField,
        verificationRequestedAtField,
        verifiedAtField,
        email,
        firstName,
        lastName,
        phone,
        groupSize,
        zipCode,
        verificationStatus: 'pending',
        verificationTokenHash: tokenHash,
        verificationRequestedAt: nowIso,
        verifiedAt: '',
      });

      if (existing) {
        await updateAirtableRecord({ apiKey, baseId, tableName, recordId: existing.id, fields });
      } else {
        await createAirtableRecord({ apiKey, baseId, tableName, fields });
      }

      const baseUrl = getPlainEnv(env, 'VERIFY_BASE_URL') || new URL(request.url).origin;
      const verifyUrl = `${baseUrl.replace(/\/$/, '')}/api/verify?token=${encodeURIComponent(token)}`;
      await sendEmail(env, { to: email, ...verificationEmail({ verifyUrl, email }) });

      return json({
        ok: true,
        awaitingConfirmation: true,
        email,
        message: `We just sent a confirmation link to ${email} — click it to complete your signup and join the list.`,
      });
    }

    const fields = buildAirtableFields({
      emailField,
      firstNameField,
      lastNameField,
      phoneField,
      groupSizeField,
      zipCodeField,
      sourceField,
      sourceValue,
      createdAtField,
      verificationStatusField,
      verificationTokenHashField,
      verificationRequestedAtField,
      verifiedAtField,
      email,
      firstName,
      lastName,
      phone,
      groupSize,
      zipCode,
      verificationStatus: 'confirmed',
      verificationTokenHash: '',
      verificationRequestedAt: nowIso,
      verifiedAt: nowIso,
    });

    if (existing) {
      await updateAirtableRecord({ apiKey, baseId, tableName, recordId: existing.id, fields });
      return json({ ok: true, alreadySubscribed: true, message: 'That email is already subscribed — we updated your details.' });
    }

    await createAirtableRecord({ apiKey, baseId, tableName, fields });
    return json({ ok: true, message: "You're on the list." });
  } catch (error) {
    console.error('subscribe error', error);

    if (String(error?.message || '').includes('Email confirmation is not configured')) {
      return json({ ok: false, error: 'Email confirmation is not configured yet.' }, 500);
    }

    if (error?.status === 401 || error?.status === 403) {
      return json({ ok: false, error: 'Airtable or email credentials do not have the required permissions.' }, 500);
    }

    if (error?.status === 404) {
      return json({ ok: false, error: 'Airtable base or table name is incorrect.' }, 500);
    }

    if (error?.status === 422) {
      return json({ ok: false, error: 'Airtable field setup does not match this form.' }, 500);
    }

    return json({ ok: false, error: 'We could not process your signup right now. Please try again.' }, 500);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
