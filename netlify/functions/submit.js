
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  const reply = (statusCode, data) => ({
    statusCode,
    headers,
    body: JSON.stringify(data)
  });

  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return reply(500, { error: "Missing server configuration." });
    }

    const apiHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    };

    // Pobieranie zatwierdzonych wpisów
    if (event.httpMethod === "GET") {
      const type = event.queryStringParameters?.type;

      const config = {
        notes: {
          table: "notes",
          columns: "id,title,body,created_at"
        },
        words: {
          table: "words",
          columns: "id,word,translation,created_at"
        }
      };

      if (!config[type]) {
        return reply(400, { error: "Unknown content type." });
      }

      const { table, columns } = config[type];
      const url = new URL(
        `${SUPABASE_URL}/rest/v1/${table}`
      );

      url.searchParams.set("select", columns);
      url.searchParams.set("status", "eq.approved");
      url.searchParams.set("order", "created_at.desc");
      url.searchParams.set("limit", "100");

      const response = await fetch(url, {
        headers: apiHeaders
      });

      if (!response.ok) {
        return reply(502, { error: "Could not load content." });
      }

      return reply(200, await response.json());
    }

    // Przyjmowanie nowych zgłoszeń
    if (event.httpMethod !== "POST") {
      return reply(405, { error: "Użyj metody POST." });
    }

    const data = JSON.parse(event.body || "{}");
    let table;
    let record;

    if (data.type === "note") {
      if (
        typeof data.title !== "string" ||
        typeof data.body !== "string" ||
        data.title.trim().length < 1 ||
        data.title.trim().length > 150 ||
        data.body.trim().length < 1 ||
        data.body.trim().length > 10000
      ) {
        return reply(400, { error: "Sprawdź tytuł i treść notatki." });
      }

      table = "notes";
      record = {
        title: data.title.trim(),
        body: data.body.trim(),
        status: "pending"
      };
    } else if (data.type === "word") {
      if (
        typeof data.word !== "string" ||
        typeof data.translation !== "string" ||
        data.word.trim().length < 1 ||
        data.word.trim().length > 100 ||
        data.translation.trim().length < 1 ||
        data.translation.trim().length > 200
      ) {
        return reply(400, { error: "Sprawdź słowo i tłumaczenie." });
      }

      table = "words";
      record = {
        word: data.word.trim(),
        translation: data.translation.trim(),
        status: "pending"
      };
    } else {
      return reply(400, { error: "Unknown submission type." });
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}`,
      {
        method: "POST",
        headers: {
          ...apiHeaders,
          Prefer: "return=minimal"
        },
        body: JSON.stringify(record)
      }
    );

    if (!response.ok) {
      return reply(400, { error: "Nie udało się wysłać zgłoszenia." });
    }

    return reply(201, {
      message: "Zgłoszenie czeka na zatwierdzenie!"
    });
  } catch (error) {
    return reply(500, { error: "Wystąpił błąd serwera." });
  }
};
