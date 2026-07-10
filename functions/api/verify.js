const SITE_TITLE = 'Recognition Dinners';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getPlainEnv(env, key) {
  return (env?.[key] || env?.[` ${key}`] || '').trim();
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

function formulaValue(value) {
  return String(value || '').replace(/'/g, "\\'");
}

async function findAirtableRecordByField({ apiKey, baseId, tableName, fieldName, value }) {
  const formula = encodeURIComponent(`{${fieldName}}='${formulaValue(value)}'`);
  const path = `${baseId}/${encodeURIComponent(tableName)}?maxRecords=1&filterByFormula=${formula}`;
  const payload = await airtableRequest({ apiKey, path });
  return payload?.records?.[0] || null;
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

function page({ title, message, success = true }) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)} · ${SITE_TITLE}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,450;0,9..144,600;1,9..144,450&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #14181F;
      --card: #232A35;
      --paper: #F5F1E8;
      --paper-dim: #DCD6C6;
      --gold: #C9A24B;
      --line: rgba(245, 241, 232, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--ink);
      color: var(--paper);
      font-family: 'Inter', sans-serif;
      display: grid;
      place-items: center;
      padding: 28px;
    }
    main {
      width: min(680px, 100%);
      background: var(--card);
      border: 0.5px solid var(--line);
      border-radius: 18px;
      padding: 36px;
      box-shadow: 0 28px 60px -32px rgba(0,0,0,0.55);
    }
    .eyebrow {
      display: inline-block;
      margin-bottom: 16px;
      color: var(--gold);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
    }
    h1 {
      font-family: 'Fraunces', serif;
      font-size: clamp(34px, 5vw, 46px);
      line-height: 1.08;
      font-weight: 450;
      margin: 0 0 14px;
    }
    p {
      margin: 0 0 16px;
      color: var(--paper-dim);
      font-size: 16px;
      line-height: 1.65;
    }
    .rule {
      margin: 22px 0 0;
      padding-top: 18px;
      border-top: 1px dashed rgba(245,241,232,0.22);
      display: flex;
      align-items: center;
      gap: 10px;
      color: ${success ? 'var(--gold)' : '#f4b6b2'};
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 700;
    }
    a {
      color: var(--paper);
    }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">${SITE_TITLE}</div>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
    <div class="rule">${success ? 'Confirmation complete' : 'Verification issue'}</div>
  </main>
</body>
</html>`, {
    status: success ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const apiKey = getPlainEnv(env, 'AIRTABLE_API_KEY');
    const baseId = getPlainEnv(env, 'AIRTABLE_BASE_ID');
    const tableName = getPlainEnv(env, 'AIRTABLE_TABLE_NAME');
    const verificationStatusField = getPlainEnv(env, 'AIRTABLE_VERIFICATION_STATUS_FIELD') || 'Verification Status';
    const verificationTokenHashField = getPlainEnv(env, 'AIRTABLE_VERIFICATION_TOKEN_HASH_FIELD') || 'Verification Token Hash';
    const verificationRequestedAtField = getPlainEnv(env, 'AIRTABLE_VERIFICATION_REQUESTED_AT_FIELD') || 'Verification Requested At';
    const verifiedAtField = getPlainEnv(env, 'AIRTABLE_VERIFIED_AT_FIELD') || 'Verified At';

    if (!apiKey || !baseId || !tableName) {
      return page({ title: 'Signup is not configured yet.', message: 'The confirmation system is missing its Airtable settings.', success: false });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token || token.length < 32) {
      return page({ title: 'Invalid confirmation link.', message: 'This link is missing a valid token. Please submit the form again for a fresh email.', success: false });
    }

    const tokenHash = await sha256(token);
    const record = await findAirtableRecordByField({
      apiKey,
      baseId,
      tableName,
      fieldName: verificationTokenHashField,
      value: tokenHash,
    });

    if (!record) {
      return page({ title: 'This confirmation link has expired.', message: 'Please submit the signup form again and we’ll send you a fresh confirmation email.', success: false });
    }

    const requestedAt = record.fields?.[verificationRequestedAtField];
    if (requestedAt) {
      const requestedAtMs = Date.parse(requestedAt);
      if (Number.isFinite(requestedAtMs) && Date.now() - requestedAtMs > TTL_MS) {
        return page({ title: 'This confirmation link has expired.', message: 'Please submit the signup form again and we’ll send you a fresh confirmation email.', success: false });
      }
    }

    const status = String(record.fields?.[verificationStatusField] || '').toLowerCase();
    if (status !== 'confirmed') {
      await updateAirtableRecord({
        apiKey,
        baseId,
        tableName,
        recordId: record.id,
        fields: {
          [verificationStatusField]: 'confirmed',
          [verificationTokenHashField]: '',
          [verifiedAtField]: new Date().toISOString(),
        },
      });
    }

    return Response.redirect(`${url.origin}/confirmed?token=${encodeURIComponent(token)}`, 302);
  } catch (error) {
    console.error('verify error', error);
    return page({ title: 'We couldn’t confirm that signup.', message: 'Please try the form again for a fresh confirmation email.', success: false });
  }
}
