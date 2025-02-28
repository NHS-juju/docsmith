const { chromium, firefox } = require("playwright");
const fs = require("fs/promises");
const Fastify = require("fastify");
const isHtml = require("is-html");
const startServer = require("./server");
const getConfig = require("./config");

const expResHeaders = {
	"cache-control": "no-store, max-age=0, must-revalidate",
	connection: "keep-alive",
	"content-length": expect.stringMatching(/\d+/),
	"content-security-policy": "default-src 'self';frame-ancestors 'none'",
	"content-type": expect.stringMatching(/^text\/plain; charset=utf-8$/i),
	date: expect.any(String),
	expires: "0",
	"permissions-policy": "interest-cohort=()",
	pragma: "no-cache",
	"referrer-policy": "no-referrer",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"surrogate-control": "no-store",
	vary: "Origin, accept-encoding",
	"x-content-type-options": "nosniff",
	"x-dns-prefetch-control": "off",
	"x-download-options": "noopen",
	"x-frame-options": "SAMEORIGIN",
	"x-permitted-cross-domain-policies": "none",
	"x-ratelimit-limit": expect.any(Number),
	"x-ratelimit-remaining": expect.any(Number),
	"x-ratelimit-reset": expect.any(Number),
};

const expResHeadersHtml = {
	...expResHeaders,
	"content-security-policy":
		"default-src 'self';base-uri 'self';img-src 'self' data:;object-src 'none';child-src 'self';frame-ancestors 'none';form-action 'self';upgrade-insecure-requests;block-all-mixed-content",
	"content-type": expect.stringMatching(/^text\/html; charset=utf-8$/i),
	"x-xss-protection": "0",
};

const expResHeadersHtmlStatic = {
	...expResHeadersHtml,
	"accept-ranges": "bytes",
	"cache-control": "public, max-age=300",
	"content-length": expect.any(Number), // @fastify/static plugin returns content-length as number
	"content-security-policy":
		"default-src 'self';base-uri 'self';img-src 'self' data:;object-src 'none';child-src 'self';frame-ancestors 'none';form-action 'self';upgrade-insecure-requests;block-all-mixed-content;script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline'",
	etag: expect.any(String),
	expires: undefined,
	"last-modified": expect.any(String),
	pragma: undefined,
	"surrogate-control": undefined,
	vary: "accept-encoding",
};

const expeResHeadersPublicImage = {
	...expResHeaders,
	"accept-ranges": "bytes",
	"cache-control": "public, max-age=31536000, immutable",
	"content-length": expect.any(Number), // @fastify/static plugin returns content-length as number
	"content-type": expect.stringMatching(/^image\//i),
	etag: expect.any(String),
	expires: undefined,
	"last-modified": expect.any(String),
	pragma: undefined,
	"surrogate-control": undefined,
	vary: "accept-encoding",
};

const expResHeadersJson = {
	...expResHeaders,
	"content-type": expect.stringMatching(
		/^application\/json; charset=utf-8$/i
	),
};

const expResHeadersText = {
	...expResHeaders,
	"content-type": expect.stringMatching(/^text\/plain; charset=utf-8$/i),
};

const expResHeaders404Errors = {
	...expResHeadersJson,
	vary: undefined,
};

const expResHeaders404ErrorsXml = {
	...expResHeaders404Errors,
	"content-security-policy":
		"default-src 'self';base-uri 'self';img-src 'self' data:;object-src 'none';child-src 'self';frame-ancestors 'none';form-action 'self';upgrade-insecure-requests;block-all-mixed-content",
	"content-type": expect.stringMatching(/^application\/xml; charset=utf-8$/i),
	"x-xss-protection": "0",
};

const expResHeaders5xxErrors = {
	...expResHeadersJson,
	vary: "accept-encoding",
};

describe("Server deployment", () => {
	describe("Bearer token and OCR disabled", () => {
		let config;
		let server;

		beforeAll(async () => {
			Object.assign(process.env, {
				AUTH_BEARER_TOKEN_ARRAY: "",
				OCR_ENABLED: false,
			});
			config = await getConfig();

			server = Fastify({ bodyLimit: 10485760, pluginTimeout: 30000 });
			await server.register(startServer, config).ready();
		});

		afterAll(async () => {
			await server.close();
		});

		describe("/admin/healthcheck route", () => {
			it("Returns `ok`", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/admin/healthcheck",
					headers: {
						accept: "text/plain",
					},
				});

				expect(response.payload).toBe("ok");
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});

			it("Returns HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/admin/healthcheck",
					headers: {
						accept: "application/javascript",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Acceptable",
					message: "Not Acceptable",
					statusCode: 406,
				});
				expect(response.headers).toEqual(expResHeadersJson);
				expect(response.statusCode).toBe(406);
			});
		});

		describe("Undeclared route", () => {
			it("Returns HTTP status code 404 if route not found", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/invalid",
					headers: {
						accept: "application/json",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Found",
					message: "Route GET:/invalid not found",
					statusCode: 404,
				});

				expect(response.headers).toEqual(expResHeaders404Errors);
				expect(response.statusCode).toBe(404);
			});

			it("Returns an XML response if media type in `Accept` request header is `application/xml`", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/invalid",
					headers: {
						accept: "application/xml",
					},
				});

				expect(response.payload).toBe(
					'<?xml version="1.0" encoding="UTF-8"?><response><statusCode>404</statusCode><error>Not Found</error><message>Route GET:/invalid not found</message></response>'
				);
				expect(response.headers).toEqual(expResHeaders404ErrorsXml);
				expect(response.statusCode).toBe(404);
			});
		});

		describe("/doc/txt route", () => {
			it("Returns DOC file converted to TXT, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/doc/txt",
					body: await fs.readFile(
						"./test_resources/test_files/valid_doc.doc"
					),
					headers: {
						accept: "application/json, text/plain",
						"content-type": "application/msword",
					},
				});

				expect(response.payload).toMatch(
					"Etiam vehicula luctus fermentum. In vel metus congue, pulvinar lectus vel, fermentum dui."
				);
				expect(isHtml(response.payload)).toBe(false);
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});
		});

		describe("/docx/html route", () => {
			it("Returns DOCX file converted to HTML, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/docx/html",
					body: await fs.readFile(
						"./test_resources/test_files/valid_docx.docx"
					),
					headers: {
						accept: "application/json, text/html",
						"content-type":
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					},
				});

				expect(response.payload).toMatch(
					"Etiam vehicula luctus fermentum. In vel metus congue, pulvinar lectus vel, fermentum dui."
				);
				expect(isHtml(response.payload)).toBe(true);
				expect(response.headers).toEqual(expResHeadersHtml);
				expect(response.statusCode).toBe(200);
			});
		});

		describe("/docx/txt route", () => {
			it("Returns DOCX file converted to TXT, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/docx/txt",
					body: await fs.readFile(
						"./test_resources/test_files/valid_docx.docx"
					),
					headers: {
						accept: "application/json, text/plain",
						"content-type":
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					},
				});

				expect(response.payload).toMatch(
					"Etiam vehicula luctus fermentum. In vel metus congue, pulvinar lectus vel, fermentum dui."
				);
				expect(isHtml(response.payload)).toBe(false);
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});
		});

		describe("/pdf/html route", () => {
			it("Returns PDF file converted to HTML, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/html",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
					},
					headers: {
						accept: "application/json, text/html",
						"content-type": "application/pdf",
					},
				});

				expect(response.payload).toMatch("for England");
				expect(isHtml(response.payload)).toBe(true);
				expect(response.headers).toEqual(expResHeadersHtml);
				expect(response.statusCode).toBe(200);
			});

			it("Returns HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/html",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
					},
					headers: {
						accept: "application/javascript",
						"content-type": "application/pdf",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Acceptable",
					message: "Not Acceptable",
					statusCode: 406,
				});
				expect(response.headers).toEqual(expResHeadersJson);
				expect(response.statusCode).toBe(406);
			});
		});

		describe("/pdf/txt route", () => {
			it("Returns PDF file converted to TXT, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/txt",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
					},
					headers: {
						accept: "application/json, text/plain",
						"content-type": "application/pdf",
					},
				});

				expect(response.payload).toMatch("for England");
				expect(isHtml(response.payload)).toBe(false);
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});
		});

		describe("/rtf/html route", () => {
			it("Returns RTF file converted to HTML, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/rtf/html",
					body: await fs.readFile(
						"./test_resources/test_files/valid_rtf.rtf"
					),
					headers: {
						accept: "application/json, text/html",
						"content-type": "application/rtf",
					},
				});

				expect(response.payload).toMatch(
					"Etiam vehicula luctus fermentum. In vel metus congue, pulvinar lectus vel, fermentum dui."
				);
				expect(isHtml(response.payload)).toBe(true);
				expect(response.headers).toEqual(expResHeadersHtml);
				expect(response.statusCode).toBe(200);
			});
		});

		describe("/rtf/txt route", () => {
			it("Returns RTF file converted to TXT, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/rtf/txt",
					body: await fs.readFile(
						"./test_resources/test_files/valid_rtf.rtf"
					),
					headers: {
						accept: "application/json, text/plain",
						"content-type": "application/rtf",
					},
				});

				expect(response.payload).toMatch(
					"Etiam vehicula luctus fermentum. In vel metus congue, pulvinar lectus vel, fermentum dui."
				);
				expect(isHtml(response.payload)).toBe(false);
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});
		});
	});

	describe("Bearer token and OCR enabled", () => {
		let config;
		let server;

		beforeAll(async () => {
			Object.assign(process.env, {
				AUTH_BEARER_TOKEN_ARRAY:
					'[{"service": "test", "value": "testtoken"}]',
				OCR_ENABLED: true,
			});
			config = await getConfig();

			server = Fastify({ pluginTimeout: 30000 });
			await server.register(startServer, config).ready();
		});

		afterAll(async () => {
			await server.close();
		});

		describe("/admin/healthcheck route", () => {
			it("Returns `ok`", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/admin/healthcheck",
					headers: {
						accept: "text/plain",
					},
				});

				expect(response.payload).toBe("ok");
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});

			it("Returns HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/admin/healthcheck",
					headers: {
						accept: "application/javascript",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Acceptable",
					message: "Not Acceptable",
					statusCode: 406,
				});
				expect(response.headers).toEqual(expResHeadersJson);
				expect(response.statusCode).toBe(406);
			});
		});

		describe("Undeclared route", () => {
			it("Returns HTTP status code 404 if route not found", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/invalid",
					headers: {
						accept: "application/json",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Found",
					message: "Route GET:/invalid not found",
					statusCode: 404,
				});

				expect(response.headers).toEqual(expResHeaders404Errors);
				expect(response.statusCode).toBe(404);
			});

			it("Returns an XML response if media type in `Accept` request header is `application/xml`", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/invalid",
					headers: {
						accept: "application/xml",
					},
				});

				expect(response.payload).toBe(
					'<?xml version="1.0" encoding="UTF-8"?><response><statusCode>404</statusCode><error>Not Found</error><message>Route GET:/invalid not found</message></response>'
				);
				expect(response.headers).toEqual(expResHeaders404ErrorsXml);
				expect(response.statusCode).toBe(404);
			});
		});

		describe("/pdf/html route", () => {
			it("Returns PDF file converted to HTML, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/html",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
					},
					headers: {
						accept: "application/json, text/html",
						authorization: "Bearer testtoken",
						"content-type": "application/pdf",
					},
				});

				expect(response.payload).toMatch("for England");
				expect(isHtml(response.payload)).toBe(true);
				expect(response.headers).toEqual(expResHeadersHtml);
				expect(response.statusCode).toBe(200);
			});

			it("Returns HTTP status code 401 if invalid bearer token provided in header", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/html",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
					},
					headers: {
						accept: "application/json, text/html",
						authorization: "Bearer invalid",
						"content-type": "application/pdf",
					},
				});

				expect(response.headers).toEqual({
					...expResHeadersJson,
					vary: "accept-encoding",
				});
				expect(response.statusCode).toBe(401);
			});

			it("Returns HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/html",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
					},
					headers: {
						accept: "application/javascript",
						authorization: "Bearer testtoken",
						"content-type": "application/pdf",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Acceptable",
					message: "Not Acceptable",
					statusCode: 406,
				});
				expect(response.headers).toEqual(expResHeadersJson);
				expect(response.statusCode).toBe(406);
			});
		});

		describe("/pdf/txt route", () => {
			it("Returns PDF file converted to TXT, with expected headers set", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/txt",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
						ocr: true,
					},
					headers: {
						accept: "application/json, text/plain",
						authorization: "Bearer testtoken",
						"content-type": "application/pdf",
					},
				});

				expect(response.payload).toMatch("NHS");
				expect(isHtml(response.payload)).toBe(false);
				expect(response.headers).toEqual(expResHeaders);
				expect(response.statusCode).toBe(200);
			});

			it("Returns HTTP status code 401 if invalid bearer token provided in header", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/txt",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
						ocr: true,
					},
					headers: {
						accept: "application/json, text/plain",
						authorization: "Bearer invalid",
						"content-type": "application/pdf",
					},
				});

				expect(response.headers).toEqual({
					...expResHeadersJson,
					vary: "accept-encoding",
				});
				expect(response.statusCode).toBe(401);
			});

			it("Returns HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
				const response = await server.inject({
					method: "POST",
					url: "/pdf/txt",
					body: await fs.readFile(
						"./test_resources/test_files/pdf_1.3_NHS_Constitution.pdf"
					),
					query: {
						lastPageToConvert: 1,
						ocr: true,
					},
					headers: {
						accept: "application/javascript",
						authorization: "Bearer testtoken",
						"content-type": "application/pdf",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Not Acceptable",
					message: "Not Acceptable",
					statusCode: 406,
				});
				expect(response.headers).toEqual(expResHeadersJson);
				expect(response.statusCode).toBe(406);
			});
		});
	});

	describe("CORS", () => {
		let config;
		let server;
		let currentEnv;

		beforeAll(() => {
			Object.assign(process.env, {
				CORS_ALLOWED_HEADERS:
					"Accept, Accept-Encoding, Accept-Language, Authorization, Content-Type, Origin, X-Forwarded-For, X-Requested-With",
				CORS_MAX_AGE: 7200,
			});
			currentEnv = { ...process.env };
		});

		const corsTests = [
			{
				testName: "CORS disabled",
				envVariables: {
					CORS_ORIGIN: "",
				},
				request: {
					headers: {
						origin: null,
					},
				},
				expected: {
					response: {
						headers: {
							json: expResHeadersJson,
							text: expResHeadersText,
						},
					},
				},
			},
			{
				testName: "CORS enabled",
				envVariables: {
					CORS_ORIGIN: true,
				},
				request: {
					headers: {
						origin: "https://notreal.nhs.uk",
					},
				},
				expected: {
					response: {
						headers: {
							json: {
								...expResHeadersJson,
								"access-control-allow-origin":
									"https://notreal.nhs.uk",
							},
							text: {
								...expResHeadersText,
								"access-control-allow-origin":
									"https://notreal.nhs.uk",
							},
						},
					},
				},
			},
			{
				testName: "CORS enabled and set to string",
				envVariables: {
					CORS_ORIGIN: "https://notreal.nhs.uk",
				},
				request: {
					headers: {
						origin: "https://notreal.nhs.uk",
					},
				},
				expected: {
					response: {
						headers: {
							json: {
								...expResHeadersJson,
								"access-control-allow-origin":
									"https://notreal.nhs.uk",
							},
							text: {
								...expResHeadersText,
								"access-control-allow-origin":
									"https://notreal.nhs.uk",
							},
						},
					},
				},
			},
			{
				testName: "CORS enabled and set to array of strings",
				envVariables: {
					CORS_ORIGIN: [
						"https://notreal.nhs.uk",
						"https://notreal.sft.nhs.uk",
					],
				},
				request: {
					headers: {
						origin: "https://notreal.nhs.uk",
					},
				},
				expected: {
					response: {
						headers: {
							json: {
								...expResHeadersJson,
								"access-control-allow-origin":
									"https://notreal.nhs.uk",
							},
							text: {
								...expResHeadersText,
								"access-control-allow-origin":
									"https://notreal.nhs.uk",
							},
						},
					},
				},
			},
			{
				testName: "CORS enabled and set to wildcard",
				envVariables: {
					CORS_ORIGIN: "*",
				},
				request: {
					headers: {
						origin: "https://notreal.nhs.uk",
					},
				},
				expected: {
					response: {
						headers: {
							json: {
								...expResHeadersJson,
								"access-control-allow-origin": "*",
							},
							text: {
								...expResHeadersText,
								"access-control-allow-origin": "*",
							},
						},
					},
				},
			},
		];
		describe.each(corsTests)(
			"$testName",
			({ envVariables, expected, request }) => {
				beforeAll(async () => {
					Object.assign(process.env, envVariables);
					config = await getConfig();

					server = Fastify();
					await server.register(startServer, config).ready();
				});

				afterAll(async () => {
					// Reset the process.env to default after all tests in describe block
					Object.assign(process.env, currentEnv);

					await server.close();
				});

				describe("/admin/healthcheck route", () => {
					it("Returns `ok`", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/admin/healthcheck",
							headers: {
								accept: "text/plain",
								origin: request.headers.origin,
							},
						});

						expect(response.payload).toBe("ok");
						expect(response.headers).toEqual(
							expected.response.headers.text
						);
						expect(response.statusCode).toBe(200);
					});

					// Only applicable if CORS enabled
					if (envVariables.CORS_ORIGIN) {
						it("Returns response to CORS preflight request", async () => {
							const response = await server.inject({
								method: "OPTIONS",
								url: "/admin/healthcheck",
								headers: {
									"access-control-request-method": "GET",
									origin: request.headers.origin,
								},
							});

							expect(response.payload).toBe("");
							expect(response.headers).toEqual({
								...expResHeaders,
								"access-control-allow-headers":
									process.env.CORS_ALLOWED_HEADERS,
								"access-control-allow-methods": "GET, HEAD",
								"access-control-allow-origin":
									envVariables.CORS_ORIGIN === "*"
										? "*"
										: request.headers.origin,
								"access-control-max-age": String(
									process.env.CORS_MAX_AGE
								),
								"content-type": undefined,
								vary: "Origin",
							});
							expect(response.statusCode).toBe(204);
						});
					}

					it("Returns HTTP status code 406 if media type in `Accept` request header is unsupported", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/admin/healthcheck",
							headers: {
								accept: "application/javascript",
								origin: request.headers.origin,
							},
						});

						expect(JSON.parse(response.payload)).toEqual({
							error: "Not Acceptable",
							message: "Not Acceptable",
							statusCode: 406,
						});
						expect(response.headers).toEqual(
							expected.response.headers.json
						);
						expect(response.statusCode).toBe(406);
					});
				});

				describe("Undeclared route", () => {
					it("Returns HTTP status code 404 if route not found", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/invalid",
							headers: {
								accept: "application/json",
								origin: request.headers.origin,
							},
						});

						expect(JSON.parse(response.payload)).toEqual({
							error: "Not Found",
							message: "Route GET:/invalid not found",
							statusCode: 404,
						});
						expect(response.headers).toEqual(
							expResHeaders404Errors
						);
						expect(response.statusCode).toBe(404);
					});

					it("Returns an XML response if media type in `Accept` request header is `application/xml`", async () => {
						const response = await server.inject({
							method: "GET",
							url: "/invalid",
							headers: {
								accept: "application/xml",
							},
						});

						expect(response.payload).toBe(
							'<?xml version="1.0" encoding="UTF-8"?><response><statusCode>404</statusCode><error>Not Found</error><message>Route GET:/invalid not found</message></response>'
						);
						expect(response.headers).toEqual(
							expResHeaders404ErrorsXml
						);
						expect(response.statusCode).toBe(404);
					});
				});
			}
		);
	});

	describe("API documentation", () => {
		let config;
		let server;

		beforeAll(async () => {
			Object.assign(process.env, {
				HOST: "localhost",
				PORT: "3000",
				HTTPS_PFX_PASSPHRASE: "",
				HTTPS_PFX_FILE_PATH: "",
				HTTPS_SSL_CERT_PATH: "",
				HTTPS_SSL_KEY_PATH: "",
				HTTPS_HTTP2_ENABLED: "",
				OCR_ENABLED: "",
			});
			config = await getConfig();

			// Turn off logging for test runs
			config.fastifyInit.logger = undefined;
			server = Fastify({ ...config.fastifyInit, pluginTimeout: 30000 });
			await server.register(startServer, config).listen(config.fastify);
		});

		afterAll(async () => {
			await server.close();
		});

		describe("Content", () => {
			describe("/docs route", () => {
				it("Returns HTML", async () => {
					const response = await server.inject({
						method: "GET",
						url: "/docs",
						headers: {
							accept: "text/html",
						},
					});

					expect(isHtml(response.payload)).toBe(true);
					expect(response.headers).toEqual(expResHeadersHtmlStatic);
					expect(response.statusCode).toBe(200);
				});
			});

			describe("/public route", () => {
				it("Returns image", async () => {
					const response = await server.inject({
						method: "GET",
						url: "/public/images/icons/favicon.ico",
						headers: {
							accept: "*/*",
						},
					});

					expect(response.headers).toEqual(expeResHeadersPublicImage);
					expect(response.statusCode).toBe(200);
				});
			});
		});

		describe("Frontend", () => {
			// Webkit not tested as it is flakey in context of Playwright
			// TODO: use `it.concurrent.each()` once it is no longer experimental
			it.each([
				{ browser: chromium, name: "Chromium" },
				{ browser: firefox, name: "Firefox" },
			])(
				"Renders docs page without error components - $name",
				async ({ browser }) => {
					const browserType = await browser.launch();
					const page = await browserType.newPage();

					await page.goto("http://localhost:3000/docs");
					await expect(page.title()).resolves.toBe(
						"Docsmith | Documentation"
					);
					/**
					 * Checks redoc has not rendered an error component:
					 * https://github.com/Redocly/redoc/blob/main/src/components/ErrorBoundary.tsx
					 */
					const heading = page.locator("h1 >> nth=0");
					await heading.waitFor();

					await expect(heading.textContent()).resolves.not.toMatch(
						/something\s*went\s*wrong/i
					);

					await page.close();
					await browserType.close();
				}
			);
		});
	});

	describe("Error handling", () => {
		let config;
		let server;

		beforeAll(async () => {
			Object.assign(process.env, {
				AUTH_BEARER_TOKEN_ARRAY: "",
				OCR_ENABLED: false,
			});
			config = await getConfig();

			server = Fastify({ pluginTimeout: 30000 });
			await server.register(startServer, config);

			server.get("/error", async () => {
				throw new Error("test");
			});

			await server.ready();
		});

		afterAll(async () => {
			await server.close();
		});

		describe("/error route", () => {
			it("Returns HTTP status code 500", async () => {
				const response = await server.inject({
					method: "GET",
					url: "/error",
					headers: {
						accept: "*/*",
					},
				});

				expect(JSON.parse(response.payload)).toEqual({
					error: "Internal Server Error",
					message: "Internal Server Error",
					statusCode: 500,
				});
				expect(response.headers).toEqual(expResHeaders5xxErrors);
				expect(response.statusCode).toBe(500);
			});
		});
	});
});
