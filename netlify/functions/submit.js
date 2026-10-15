const crypto = require("crypto");

// Czyści wartość z Netlify: spacje, cudzysłowy, końcowe "/", doklejone "/rest/v1"
function normalizeSupabaseUrl(value) {
  if (!value) return "";

  let url = String(value).trim().replace(/^["']+|["']+$/g, "").trim();

  url = url.replace(/\/+$/, "");
  url = url.replace(/\/rest\/v1$/i, "");
  url = url.replace(/\/+$/, "");

  return url;
}

const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function reply(statusCode, data) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(data)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Porównanie hasła odporne na ataki czasowe
function passwordMatches(input) {
  if (!ADMIN_PASSWORD) {
    throw new Error("Brakuje ADMIN_PASSWORD w zmiennych Netlify.");
  }

  if (typeof input !== "string") return false;

  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();

  return crypto.timingSafeEqual(a, b);
}

async function supabaseRequest(path, options = {}, apiKey = SUPABASE_KEY) {
  if (!SUPABASE_URL || !apiKey) {
    throw new Error(
      "Brakuje SUPABASE_URL lub klucza Supabase w zmiennych Netlify."
    );
  }

  let parsed;
  try {
    parsed = new URL(SUPABASE_URL);
  } catch {
    throw new Error(
      "SUPABASE_URL jest nieprawidłowy. Użyj samego adresu projektu, " +
        "np. https://abcdefgh.supabase.co"
    );
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(
      "SUPABASE_URL nie może zawierać ścieżki. Użyj samego adresu projektu, " +
        "np. https://abcdefgh.supabase.co"
    );
  }

  const requestHeaders = {
    apikey: apiKey,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (apiKey.split(".").length === 3) {
    requestHeaders.Authorization = `Bearer ${apiKey}`;
  }

  const url = `${parsed.origin}/rest/v1/${path}`;
  console.log("Supabase request:", options.method || "GET", url);

  return fetch(url, { ...options, headers: requestHeaders });
}

async function supabaseError(response) {
  const text = await response.text();

  try {
    const data = JSON.parse(text);
    return {
      error: "Supabase odrzucił żądanie.",
      supabaseCode: data.code || null,
      supabaseMessage: data.message || text
    };
  } catch {
    return {
      error: "Supabase odrzucił żądanie.",
      supabaseCode: null,
      supabaseMessage: text.slice(0, 500)
    };
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
      };
    }

    if (event.httpMethod === "GET") {
      const type = event.queryStringParameters?.type;
      let path;

      if (type === "words") {
        path =
          "words?select=id,word,emoji" +
          "&status=eq.approved&order=created_at.desc&limit=100";
      } else if (type === "notes") {
        path =
          "notes?select=id,title,body,created_at" +
          "&status=eq.approved&order=created_at.desc&limit=100";
      } else {
        return reply(400, {
          error: "Użyj ?type=words lub ?type=notes."
        });
      }

      const response = await supabaseRequest(path);

      if (!response.ok) {
        return reply(502, await supabaseError(response));
      }

      return reply(200, await response.json());
    }

    if (event.httpMethod !== "POST") {
      return reply(405, { error: "Użyj metody GET lub POST." });
    }

    let data;

    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      return reply(400, { error: "Nieprawidłowy format danych." });
    }

    // --- Logowanie administratora (sprawdzenie hasła) ---
    if (data.type === "admin-check") {
      if (!passwordMatches(data.password)) {
        await sleep(600);
        return reply(401, { error: "Wrong password." });
      }

      return reply(200, { ok: true });
    }

    // --- Usuwanie wpisu (tylko z hasłem) ---
    if (data.type === "delete") {
      if (!passwordMatches(data.password)) {
        await sleep(600);
        return reply(401, { error: "Wrong password." });
      }

      if (!SUPABASE_SERVICE_KEY) {
        throw new Error("Brakuje SUPABASE_SERVICE_KEY w zmiennych Netlify.");
      }

      const table =
        data.table === "word" ? "words" : data.table === "note" ? "notes" : null;

      if (!table) {
        return reply(400, { error: "Nieznany typ wpisu do usunięcia." });
      }

      const id = String(data.id ?? "");

      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        return reply(400, { error: "Nieprawidłowe ID wpisu." });
      }

      const response = await supabaseRequest(
        `${table}?id=eq.${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { Prefer: "return=representation" }
        },
        SUPABASE_SERVICE_KEY
      );

      if (!response.ok) {
        return reply(502, await supabaseError(response));
      }

      const deleted = await response.json();

      if (!Array.isArray(deleted) || deleted.length === 0) {
        return reply(404, { error: "Nie znaleziono wpisu do usunięcia." });
      }

      return reply(200, { message: "Usunięto." });
    }

    // --- Dodawanie słówka ---
    if (data.type === "word") {
      const word = typeof data.word === "string" ? data.word.trim() : "";
      const emoji =
        typeof data.emoji === "string" && data.emoji.trim()
          ? data.emoji.trim()
          : "✨";

      if (!word || word.length > 100) {
        return reply(400, { error: "Wpisz słowo (maks. 100 znaków)." });
      }

      if (emoji.length > 32) {
        return reply(400, { error: "Wybierz emoji." });
      }

      const response = await supabaseRequest("words", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          word,
          emoji,
          status: "pending"
        })
      });

      if (!response.ok) {
        return reply(502, await supabaseError(response));
      }

      return reply(201, {
        message: "Słówko wysłane do zatwierdzenia."
      });
    }

    // --- Dodawanie notatki ---
    if (data.type === "note") {
      const title = typeof data.title === "string" ? data.title.trim() : "";
      const body = typeof data.body === "string" ? data.body.trim() : "";

      if (!title || title.length > 150) {
        return reply(400, { error: "Wpisz tytuł (maks. 150 znaków)." });
      }

      if (!body || body.length > 10000) {
        return reply(400, { error: "Wpisz treść notatki (maks. 10000 znaków)." });
      }

      const response = await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          title,
          body,
          status: "pending"
        })
      });

      if (!response.ok) {
        return reply(502, await supabaseError(response));
      }

      return reply(201, {
        message: "Notatka wysłana do zatwierdzenia."
      });
    }

    return reply(400, {
      error: "Nieznany typ treści. Użyj word, note, delete lub admin-check."
    });
  } catch (error) {
    console.error("Netlify function error:", error);

    return reply(500, {
      error: error.message || "Nieoczekiwany błąd serwera."
    });
  }
};
