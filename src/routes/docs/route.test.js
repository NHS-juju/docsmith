const accepts = require("fastify-accepts");
const Fastify = require("fastify");
const isHtml = require("is-html");
const sensible = require("fastify-sensible");
const staticPlugin = require("fastify-static");
const path = require("path");
const route = require(".");
const getConfig = require("../../config");
const sharedSchemas = require("../../plugins/shared-schemas");

describe("Docs Route", () => {
	describe("GET Requests", () => {
		let config;
		let server;

		beforeAll(async () => {
			config = await getConfig();

			server = Fastify();
			server
				.register(accepts)
				.register(sensible)
				.register(staticPlugin, {
					root: path.join(__dirname, "../..", "public"),
				})
				.register(staticPlugin, {
					root: path.join(
						__dirname,
						"../../..",
						"node_modules",
						"redoc",
						"bundles"
					),
					prefix: "/redoc/",
					decorateReply: false,
				})
				.register(sharedSchemas)
				.register(route, config);

			await server.ready();
		});

		afterAll(async () => {
			await server.close();
		});

		test("Should return HTML", async () => {
			const response = await server.inject({
				method: "GET",
				url: "/",
				headers: {
					accept: "text/html",
				},
			});

			expect(isHtml(response.payload)).toEqual(true);
			expect(response.statusCode).toEqual(200);
		});

		test("Should return HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
			const response = await server.inject({
				method: "GET",
				url: "/",
				headers: {
					accept: "application/javascript",
				},
			});

			expect(response.statusCode).toEqual(406);
		});
	});
});