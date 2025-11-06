export const respond = (response: any) => {
    const { status, message, data } = response;
    const formattedData =
        data === undefined || data === null
            ? ""
            : Array.isArray(data)
                ? data.map((item) => `• ${JSON.stringify(item)}`).join("\n")
                : typeof data === "string"
                    ? data
                    : JSON.stringify(data, null, 2);

    const formattedText = `{ "status": ${status},
  "message": "${message}", \n${formattedData ? `"data": ${formattedData}` : ""}}`;

    return {
        content: [{ type: "text", text: formattedText }],
    };
};

export const respondError = (err: unknown) => ({
    content: [
        {
            type: "text",
            text: `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
        },
    ],
    isError: true,
});
