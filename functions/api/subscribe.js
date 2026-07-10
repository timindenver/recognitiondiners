const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

function getPlainEnv(env, key) {
  return (env?.[key] || env?.[` ${key}`] || '').trim();
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

async function findAirtableRecordByEmail({ apiKey, baseId, tableName, emailField, email }) {
  const formula = encodeURIComponent(`LOWER({${emailField}})='${email.replace(/'/g, "\\'")}'`);
  const path = `${baseId}/${encodeURIComponent(tableName)}?maxRecords=1&fields%5B%5D=${encodeURIComponent(emailField)}&filterByFormula=${formula}`;
  const payload = await airtableRequest({ apiKey, path });
  return payload?.records?.[0] || null;
}

async function createAirtableRecord({ apiKey, baseId, tableName, emailField, email, sourceField, sourceValue, createdAtField }) {
  const fields = {
    [emailField]: email,
  };

  if (sourceField && sourceValue) fields[sourceField] = sourceValue;
  if (createdAtField) fields[createdAtField] = new Date().toISOString();

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

export async function onRequestPost({ request, env }) {
  try {
    const apiKey = getPlainEnv(env, 'AIRTABLE_API_KEY');
    const baseId = getPlainEnv(env, 'AIRTABLE_BASE_ID');
    const tableName = getPlainEnv(env, 'AIRTABLE_TABLE_NAME');
    const emailField = getPlainEnv(env, 'AIRTABLE_EMAIL_FIELD') || 'Email';
    const sourceField = getPlainEnv(env, 'AIRTABLE_SOURCE_FIELD');
    const sourceValue = getPlainEnv(env, 'AIRTABLE_SOURCE_VALUE') || 'recognitiondinners.com';
    const createdAtField = getPlainEnv(env, 'AIRTABLE_CREATED_AT_FIELD');

    if (!apiKey || !baseId || !tableName) {
      return json({ ok: false, error: 'Signup is not configured yet.' }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();

    if (!isEmail(email)) {
      return json({ ok: false, error: 'Please enter a valid email.' }, 400);
    }

    const existing = await findAirtableRecordByEmail({
      apiKey,
      baseId,
      tableName,
      emailField,
      email,
    });

    if (existing) {
      return json({ ok: true, alreadySubscribed: true, message: 'That email is already subscribed.' });
    }

    await createAirtableRecord({
      apiKey,
      baseId,
      tableName,
      emailField,
      email,
      sourceField,
      sourceValue,
      createdAtField,
    });

    return json({ ok: true, message: "You're on the list." });
  } catch (error) {
    console.error('subscribe error', error);

    if (error?.status === 401 || error?.status === 403) {
      return json({ ok: false, error: 'Airtable credentials do not have the required permissions.' }, 500);
    }

    if (error?.status === 404) {
      return json({ ok: false, error: 'Airtable base or table name is incorrect.' }, 500);
    }

    if (error?.status === 422) {
      return json({ ok: false, error: 'Airtable field setup does not match this form.' }, 500);
    }

    return json({ ok: false, error: 'We could not save your signup right now.' }, 500);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
