/* eslint-disable security/detect-non-literal-fs-filename */
const fp = require("fastify-plugin");
const fs = require("fs/promises");
const { JSDOM } = require("jsdom");
const path = require("upath");

/**
 * @author Frazer Smith
 * @description Decorator plugin that adds function to embed images into HTML,
 * after encoding with Base64.
 * @param {object} server - Fastify instance.
 * @param {object} options - Plugin config values.
 * @param {string} options.tempDir - Directory for temporarily storing
 * files during conversion.
 */
async function plugin(server, options) {
	/**
	 * @param {string} html - Valid HTML.
	 * @returns {Promise<string|Error>} Promise of tidied HTML string with images embedded on resolve, or Error object on rejection.
	 */
	async function embedHtmlImages(html) {
		const dom = new JSDOM(html);
		const images = dom.window.document.querySelectorAll("img");
		const directory = path.normalizeTrim(options.tempDir);

		await Promise.all(
			Array.from(images, (image) => {
				const imgForm = path.extname(image.src).substring(1);

				return fs
					.readFile(path.joinSafe(directory, image.src), "base64")
					.then((imageAsBase64) =>
						image.setAttribute(
							"src",
							`data:image/${imgForm};base64,${imageAsBase64}`
						)
					);
			})
		);

		return dom.serialize();
	}

	server.decorate("embedHtmlImages", embedHtmlImages);
}

module.exports = fp(plugin, {
	fastify: "4.x",
	name: "embed-html-images",
});
