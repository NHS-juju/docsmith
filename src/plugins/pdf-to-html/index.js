/* eslint-disable security/detect-non-literal-fs-filename */
/* eslint-disable security/detect-object-injection */
const autoParse = require("auto-parse");
const fixUtf8 = require("fix-utf8");
const fp = require("fastify-plugin");
const fs = require("fs").promises;
const glob = require("glob");
const { JSDOM } = require("jsdom");
const path = require("upath");
const { Poppler } = require("node-poppler");
const { v4 } = require("uuid");

/**
 * @author Frazer Smith
 * @description Pre-handler plugin that uses Poppler to convert Buffer containing
 * PDF file in `req.body` to HTML and places HTML file in a temporary directory.
 * `req` object is decorated with `conversionResults` object detailing document
 * location and contents.
 * @param {Function} server - Fastify instance.
 * @param {object} options - Plugin config values.
 * @param {string} options.binPath - Path to Poppler binary.
 * @param {object} options.pdfToHtmlOptions - Refer to
 * https://github.com/Fdawgs/node-poppler/blob/master/API.md#Poppler+pdfToHtml
 * for options.
 * @param {string} options.pdfToHtmlOptions.encoding - Sets the encoding to use for text output.
 * @param {string=} options.tempDirectory - Directory for temporarily storing
 * files during conversion.
 */
async function plugin(server, options) {
	server.addHook("onRequest", async (req) => {
		req.conversionResults = { body: undefined };
	});

	// "onSend" hook used instead of "onResponse" ensures
	// cancelled request temp data is also removed
	server.addHook("onSend", async (req, res) => {
		if (req?.conversionResults?.docLocation) {
			// Remove files from temp directory after response sent
			const files = glob.sync(
				`${path.joinSafe(
					req.conversionResults.docLocation.directory,
					req.conversionResults.docLocation.id
				)}*`
			);

			await Promise.all(files.map((file) => fs.unlink(file)));
		}

		return res;
	});

	server.addHook("preHandler", async (req, res) => {
		// Define any default settings the plugin should have to get up and running
		const config = {
			binPath: undefined,
			pdfToHtmlOptions: {
				complexOutput: true,
				outputEncoding: "UTF-8",
				singlePage: true,
			},
			tempDirectory: path.joinSafe(__dirname, "..", "temp"),
		};
		Object.assign(config, options);

		const directory = path.normalizeTrim(config.tempDirectory);
		const poppler = new Poppler(config.binPath);

		/**
		 * Create copy of query string params and prune that,
		 * as some of the params may be used in other plugins
		 */
		const query = { ...req.query };
		const pdfToHtmlAcceptedParams = [
			"exchangePdfLinks",
			"extractHidden",
			"firstPageToConvert",
			"ignoreImages",
			"imageFormat",
			"lastPageToConvert",
			"noDrm",
			"noMergeParagraph",
			"outputEncoding",
			"ownerPassword",
			"userPassword",
			"wordBreakThreshold",
			"zoom",
		];
		Object.keys(query).forEach((value) => {
			if (!pdfToHtmlAcceptedParams.includes(value)) {
				delete query[value];
			} else {
				/**
				 * Convert query string params to literal values to
				 * allow Poppler module to use them
				 */
				query[value] = autoParse(query[value]);
			}
		});
		Object.assign(config.pdfToHtmlOptions, query);

		// Create temp directory if missing
		await fs.mkdir(directory).catch((err) => {
			// Ignore "EEXIST: An object by the name pathname already exists" error
			/* istanbul ignore if */
			if (err.code !== "EEXIST") {
				throw err;
			}
		});

		// Build temporary file for Poppler to write to, and following plugins to read from
		const id = v4();
		const tempFile = path.joinSafe(directory, id);
		req.conversionResults.docLocation = {
			directory,
			html: tempFile,
			id,
		};

		await poppler
			.pdfToHtml(req.body, `${tempFile}.html`, config.pdfToHtmlOptions)
			.catch((err) => {
				/**
				 * Poppler will throw if the .pdf file provided
				 * by client is malformed, thus client error code
				 */
				/* istanbul ignore else */
				if (/Syntax Error:/.test(err)) {
					throw res.badRequest();
				} else {
					throw err;
				}
			});

		// Remove excess title and meta tags left behind by Poppler
		// Poppler appends `-html` to the file name, thus the template literal here
		const dom = new JSDOM(
			await fs.readFile(`${tempFile}-html.html`, {
				encoding: config.pdfToHtmlOptions.outputEncoding,
			})
		);
		const titles = dom.window.document.querySelectorAll("title");
		for (let index = 1; index < titles.length; index += 1) {
			titles[index].parentNode.removeChild(titles[index]);
		}
		const metas = dom.window.document.querySelectorAll("meta");
		for (let index = 1; index < metas.length; index += 1) {
			metas[index].parentNode.removeChild(metas[index]);
		}

		/**
		 * `fixUtf8` function replaces most common incorrectly converted
		 * Windows-1252 to UTF-8 results with HTML equivalents.
		 * Refer to https://www.i18nqa.com/debug/utf8-debug.html for more info.
		 */
		req.conversionResults.body = fixUtf8(dom.serialize());

		res.header(
			"content-type",
			`text/html; charset=${config.pdfToHtmlOptions.outputEncoding.toLowerCase()}`
		);
	});
}

module.exports = fp(plugin, {
	fastify: "3.x",
	name: "pdf-to-html",
	dependencies: ["fastify-sensible"],
});
