const TIMEOUT_MS = 5000;

const RECORD_TYPES = [
  "A",
  "AAAA",
  "MX",
  "NS",
  "TXT",
  "SOA",
  "CAA",
  "DNSKEY",
  "SRV",
  "CNAME",
];

function clean(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function isValidName(value) {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    /^[a-z0-9_*.-]+$/i.test(value) &&
    !value.includes("..")
  );
}

async function fetchRecord(endpoint, name, type) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`;
    const response = await fetch(url, {
      headers: {
        accept: "application/dns-json",
        "user-agent": "merged-dns-api/1.0",
      },
      signal: controller.signal,
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Upstream HTTP ${response.status}`);
    }

    return {
      httpStatus: response.status,
      dnsStatus: body.Status ?? null,
      dnssecAuthenticated: Boolean(body.AD),
      truncated: Boolean(body.TC),
      question: Array.isArray(body.Question) ? body.Question : [],
      answer: Array.isArray(body.Answer) ? body.Answer : [],
      authority: Array.isArray(body.Authority) ? body.Authority : [],
      additional: Array.isArray(body.Additional) ? body.Additional : [],
      ...(body.Comment ? { comment: body.Comment } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function recordKey(record) {
  return [record.name, record.type, record.TTL, record.data].join("|");
}

function mergeAnswers(providerResults) {
  const merged = {};

  for (const type of RECORD_TYPES) {
    const records = providerResults
      .map((provider) => provider?.records?.[type]?.answer || [])
      .flat();

    merged[type] = records.filter(
      (record, index, all) =>
        all.findIndex((item) => recordKey(item) === recordKey(record)) === index,
    );
  }

  return merged;
}

async function queryProvider(endpoint, name, types) {
  const started = Date.now();
  const results = await Promise.all(
    types.map(async (type) => {
      try {
        return [type, await fetchRecord(endpoint, name, type)];
      } catch (error) {
        return [
          type,
          {
            httpStatus: null,
            dnsStatus: null,
            error: "This record lookup failed.",
          },
        ];
      }
    }),
  );

  return {
    responseTimeMs: Date.now() - started,
    records: Object.fromEntries(results),
  };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Only GET is supported.",
    });
  }

  const name =
    typeof req.query?.name === "string"
      ? req.query.name.trim().replace(/\.$/, "").toLowerCase()
      : "";
  const requestedType =
    typeof req.query?.type === "string"
      ? req.query.type.trim().toUpperCase()
      : "ALL";

  if (!isValidName(name)) {
    return res.status(400).json({
      success: false,
      error: "The name parameter must be a valid DNS name.",
    });
  }

  if (requestedType !== "ALL" && !RECORD_TYPES.includes(requestedType)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported record type. Use ALL, ${RECORD_TYPES.join(", ")}.`,
    });
  }

  const types =
    requestedType === "ALL" ? RECORD_TYPES : [requestedType];
  const endpoints = {
    cloudflare: "https://cloudflare-dns.com/dns-query",
    google: "https://dns.google/resolve",
  };

  const [cloudflare, google] = await Promise.all([
    queryProvider(endpoints.cloudflare, name, types),
    queryProvider(endpoints.google, name, types),
  ]);

  const providerResults = [cloudflare, google];
  const allRecordResults = Object.values({
    ...cloudflare.records,
    ...google.records,
  });
  const successfulResults = allRecordResults.filter(
    (record) => record.httpStatus === 200,
  );

  if (successfulResults.length === 0) {
    return res.status(502).json({
      success: false,
      error: "Both DNS providers are temporarily unavailable.",
    });
  }

  const mergedAnswers = mergeAnswers(providerResults);
  const answerCount = Object.values(mergedAnswers).reduce(
    (total, records) => total + records.length,
    0,
  );

  const response = {
    success: true,
    query: {
      name,
      requestedType,
      recordTypes: types,
    },
    found: answerCount > 0,
    answerCount,
    mergedAnswers,
    providers: {
      cloudflare,
      google,
    },
  };

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
  );
  return res.status(200).json(response);
}

module.exports = handler;