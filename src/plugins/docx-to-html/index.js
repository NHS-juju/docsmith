const fixUtf8 = require("fix-utf8");
const fp = require("fastify-plugin");
const { JSDOM } = require("jsdom");
const { convertToHtml } = require("mammoth");
const { randomUUID } = require("crypto");
const WordExtractor = require("word-extractor");

/**
 * @author Frazer Smith
 * @description Pre-handler plugin that uses Mammoth and Word-Extractor to convert Buffer containing
 * DOCX file in `req.body` to HTML.
 * `req` object is decorated with `conversionResults.body` holding the converted document.
 * @param {object} server - Fastify instance.
 */
async function plugin(server) {
	const wordExtractor = new WordExtractor();

	server.addHook("onRequest", async (req) => {
		req.conversionResults = { body: undefined };
	});

	server.addHook("preHandler", async (req, res) => {
		try {
			const results = await wordExtractor.extract(req.body);
			const { value } = await convertToHtml(req.body);

			/**
			 * Mammoth does not wrap the results inside <html> and <body> tags itself.
			 * `fixUtf8` function replaces most common incorrectly converted
			 * Windows-1252 to UTF-8 results with HTML equivalents.
			 * Refer to https://i18nqa.com/debug/utf8-debug.html for more info
			 */
			req.conversionResults.body = new JSDOM(
				`<!DOCTYPE html>
			<head>
				<meta content="text/html; charset=utf-8" http-equiv="Content-Type">
				<title>docsmith_docx-to-html_${randomUUID()}</title>
			</head>
			<html>
				<body>
					<div>
						<header>${fixUtf8(results.getHeaders({ includeFooters: false }))}</header>
						${fixUtf8(value)}
						<footer>${fixUtf8(results.getFooters())}</footer>
					</div>
				</body>
			</html>`
			).serialize();

			res.type("text/html; charset=utf-8");
		} catch {
			/**
			 * Mammoth will throw if the .docx file provided
			 * by client is malformed, thus client error code
			 */
			throw server.httpErrors.badRequest();
		}
	});
}

module.exports = fp(plugin, {
	fastify: "4.x",
	name: "docx-to-html",
	dependencies: ["@fastify/sensible"],
});
