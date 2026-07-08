export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const contentType = request.headers.get('content-type') || '';

    let email = '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      email = String(body?.email || '').trim().toLowerCase();
    } else {
      const formData = await request.formData();
      email = String(formData.get('email') || '').trim().toLowerCase();
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: 'Please enter a valid work email.' }, 400);
    }

    const airtableApiKey = env.AIRTABLE_API_KEY;
    const airtableBaseId = env.AIRTABLE_BASE_ID;
    const airtableTableName = env.AIRTABLE_TABLE_NAME || env[' AIRTABLE_TABLE_NAME'];

    if (!airtableApiKey || !airtableBaseId || !airtableTableName) {
      return json({ ok: false, error: 'List signup is not fully configured yet.' }, 500);
    }

    const payload = {
      performUpsert: { fieldsToMergeOn: ['Email'] },
      records: [
        {
          fields: {
            Email: email,
            Source: 'recognitiondinners.com website',
            Status: 'active',
            CreatedAt: new Date().toISOString(),
          },
        },
      ],
      typecast: true,
    };

    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTableName)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${airtableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const data = await airtableRes.json();
    if (!airtableRes.ok) {
      return json(
        {
          ok: false,
          error: data?.error?.message || 'Airtable rejected the signup.',
        },
        airtableRes.status,
      );
    }

    return json({ ok: true, message: "You're on the list." });
  } catch (error) {
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
    },
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}
