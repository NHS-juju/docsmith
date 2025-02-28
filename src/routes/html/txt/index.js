const isHtml = require("is-html");

// Import plugins
const cors = require("@fastify/cors");
const htmlToTxt = require("../../../plugins/html-to-txt");

const { htmlToTxtPostSchema } = require("./schema");

const accepts = ["text/plain"];

/**
 * @author Frazer Smith
 * @description Sets routing options for server.
 * @param {object} server - Fastify instance.
 * @param {object} options - Route config values.
 * @param {*=} options.bearerTokenAuthKeys - Apply `bearerToken` security scheme to route if defined.
 * @param {object} options.cors - CORS settings.
 */
async function route(server, options) {
	if (options.bearerTokenAuthKeys) {
		htmlToTxtPostSchema.security = [{ bearerToken: [] }];
		htmlToTxtPostSchema.response[401] = {
			$ref: "responses#/properties/unauthorized",
			description: "Unauthorized",
		};
	}

	server.addContentTypeParser(
		"text/html",
		{ parseAs: "string" },
		async (_req, payload) => {
			/**
			 * The Content-Type header can be spoofed so is not trusted implicitly,
			 * this checks the payload is HTML
			 */
			if (!isHtml(payload)) {
				throw server.httpErrors.unsupportedMediaType();
			}
			return payload;
		}
	);

	// Register plugins
	await server
		// Enable CORS if options passed
		.register(cors, {
			...options.cors,
			methods: ["POST"],
		})
		.register(htmlToTxt);

	server.route({
		method: "POST",
		url: "/",
		schema: htmlToTxtPostSchema,
		onRequest: async (req) => {
			if (
				// Catch unsupported Accept header media types
				!req.accepts().type(accepts)
			) {
				throw server.httpErrors.notAcceptable();
			}
		},
		handler: (req, res) => {
			res.send(req.conversionResults.body);
		},
	});
}

module.exports = route;
