
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Użyj metody POST." })
    };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Brak konfiguracji Supabase.");
    }

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
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Sprawdź tytuł i treść notatki." })
        };
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
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Sprawdź słowo i tłumaczenie." })
        };
      }

      table = "words";
      record = {
        word: data.word.trim(),
        translation: data.translation.trim(),
        status: "pending"
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Nieznany typ zgłoszenia." })
      };
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(record)
      }
    );

    if (!response.ok) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Nie udało się zapisać zgłoszenia."
        })
      };
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: "Zgłoszenie wysłane do zatwierdzenia!"
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Wystąpił błąd serwera."
      })
    };
  }
};
