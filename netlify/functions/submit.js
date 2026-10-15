
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Brakuje konfiguracji Supabase w Netlify.");
  }

  return fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );
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
          "words?select=word,translation,emoji,created_at" +
          "&status=eq.approved&order=created_at.desc&limit=100";
      } else if (type === "notes") {
        path =
          "notes?select=title,body,created_at" +
          "&status=eq.approved&order=created_at.desc&limit=100";
      } else {
        return reply(400, {
          error: "Podaj typ: ?type=words lub ?type=notes."
        });
      }

      const response = await supabaseRequest(path);

      if (!response.ok) {
        console.error("Supabase GET:", await response.text());
        return reply(502, {
          error: "Nie udało się pobrać danych. Sprawdź konfigurację Supabase."
        });
      }

      return reply(200, await response.json());
    }

    if (event.httpMethod !== "POST") {
      return reply(405, {
        error: "Użyj metody GET lub POST."
      });
    }

    let data;

    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      return reply(400, {
        error: "Nieprawidłowy format danych."
      });
    }

    if (data.type === "word") {
      const word = typeof data.word === "string"
        ? data.word.trim()
        : "";

      const translation = typeof data.translation === "string"
        ? data.translation.trim()
        : "";

      const emoji = typeof data.emoji === "string"
        ? data.emoji.trim()
        : "✨";

      if (!word || word.length > 100) {
        return reply(400, {
          error: "Wpisz słówko (maksymalnie 100 znaków)."
        });
      }

      if (!translation || translation.length > 200) {
        return reply(400, {
          error: "Wpisz tłumaczenie (maksymalnie 200 znaków)."
        });
      }

      if (!emoji || emoji.length > 32) {
        return reply(400, {
          error: "Wybierz poprawne emoji."
        });
      }

      const response = await supabaseRequest("words", {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          word,
          translation,
          emoji,
          status: "pending"
        })
      });

      if (!response.ok) {
        const details = await response.text();
        console.error("Supabase words POST:", details);

        return reply(502, {
          error: "Nie udało się zapisać słówka. Sprawdź tabelę words w Supabase."
        });
      }

      return reply(201, {
        message: "Słówko wysłane do zatwierdzenia."
      });
    }

    if (data.type === "note") {
      const title = typeof data.title === "string"
        ? data.title.trim()
        : "";

      const body = typeof data.body === "string"
        ? data.body.trim()
        : "";

      if (!title || title.length > 150) {
        return reply(400, {
          error: "Wpisz tytuł (maksymalnie 150 znaków)."
        });
      }

      if (!body || body.length > 10000) {
        return reply(400, {
          error: "Wpisz treść notatki (maksymalnie 10000 znaków)."
        });
      }

      const response = await supabaseRequest("notes", {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          title,
          body,
          status: "pending"
        })
      });

      if (!response.ok) {
        const details = await response.text();
        console.error("Supabase notes POST:", details);

        return reply(502, {
          error: "Nie udało się zapisać notatki. Sprawdź tabelę notes w Supabase."
        });
      }

      return reply(201, {
        message: "Notatka wysłana do zatwierdzenia."
      });
    }

    return reply(400, {
      error: "Nieznany typ treści. Wymagany typ: word lub note."
    });
  } catch (error) {
    console.error("Netlify function error:", error);

    return reply(500, {
      error: "Błąd serwera. Sprawdź logi funkcji w Netlify."
    });
  }
};
