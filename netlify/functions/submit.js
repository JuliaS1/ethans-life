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

const IMAGE_BUCKET = "word-images";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// Rozpoznaje typ obrazka po bajtach pliku (nie ufamy typowi z przeglądarki)
function detectImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buf.length > 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (buf.length > 6 && buf.subarray(0, 4).toString("latin1") === "GIF8") {
    return { mime: "image/gif", ext: "gif" };
  }
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

function storageHeaders(extra = {}) {
  const h = { apikey: SUPABASE_SERVICE_KEY, ...extra };

  if (SUPABASE_SERVICE_KEY.split(".").length === 3) {
    h.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
  }

  return h;
}

async function uploadImage(base64) {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error("Brakuje SUPABASE_SERVICE_KEY w zmiennych Netlify.");
  }

  const buf = Buffer.from(base64, "base64");

  if (!buf.length || buf.length > MAX_IMAGE_BYTES) {
    return { error: "Obrazek jest za duży (maks. 3 MB)." };
  }

  const type = detectImage(buf);

  if (!type) {
    return { error: "Dozwolone są tylko obrazki JPG, PNG, GIF i WEBP." };
  }

  const name = `${crypto.randomUUID()}.${type.ext}`;
  const origin = new URL(SUPABASE_URL).origin;

  const response = await fetch(
    `${origin}/storage/v1/object/${IMAGE_BUCKET}/${name}`,
    {
      method: "POST",
      headers: storageHeaders({ "Content-Type": type.mime }),
      body: buf
    }
  );

  if (!response.ok) {
    return { storageError: await supabaseError(response) };
  }

  return { url: `${origin}/storage/v1/object/public/${IMAGE_BUCKET}/${name}` };
}

async function removeImage(url) {
  if (!url || !SUPABASE_SERVICE_KEY) return;

  const origin = new URL(SUPABASE_URL).origin;
  const marker = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
  const text = String(url);
  const index = text.indexOf(marker);

  if (index === -1) return;

  const name = text.slice(index + marker.length);

  if (!/^[A-Za-z0-9-]+\.(jpg|png|gif|webp)$/.test(name)) return;

  try {
    await fetch(`${origin}/storage/v1/object/${IMAGE_BUCKET}/${name}`, {
      method: "DELETE",
      headers: storageHeaders()
    });
  } catch (error) {
    console.error("Nie udało się usunąć obrazka:", error);
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
          "words?select=id,word,emoji,description,image_url" +
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

      await removeImage(deleted[0].image_url);

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

      const description =
        typeof data.description === "string" ? data.description.trim() : "";

      if (description.length > 300) {
        return reply(400, { error: "Opis może mieć maks. 300 znaków." });
      }

      let imageUrl = null;

      if (typeof data.imageData === "string" && data.imageData) {
        const uploaded = await uploadImage(data.imageData);

        if (uploaded.error) {
          return reply(400, { error: uploaded.error });
        }

        if (uploaded.storageError) {
          return reply(502, uploaded.storageError);
        }

        imageUrl = uploaded.url;
      }

      const response = await supabaseRequest("words", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          word,
          emoji,
          description: description || null,
          image_url: imageUrl,
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
