import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "cloudflare:workers";

// Placeholder types for serverless environment
type Env = { GOOGLE_API_KEY?: string; EASYPOST_API_KEY?: string; EASYPOST_CARRIER_ACCOUNT_ID?: string }; 
type ExecutionContext = any;

// Define Enums
export const LetterType = z.enum(['Letter 8.5 x 11', 'Letter 8.5 x 14']);
export type LetterType = z.infer<typeof LetterType>;

export const PostcardType = z.enum(['Postcard 4.25 x 6', 'Postcard 4 x 9', 'Postcard 5 x8']);
export type PostcardType = z.infer<typeof PostcardType>;

// Define Models using Zod
export const AddressSchema = z.object({
    name: z.string(),
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip_code: z.string(),
    country: z.string().default('US'),
});
export type Address = z.infer<typeof AddressSchema>;

export const AddressValidationResultSchema = z.object({
    is_valid: z.boolean(),
    corrected_address: z.record(z.any()), // Using record(z.any()) for dict
    original_address: z.record(z.any()),
    messages: z.array(z.string()),
});
export type AddressValidationResult = z.infer<typeof AddressValidationResultSchema>;

export const SendLetterInputSchema = z.object({
    to: AddressSchema,
    from_: AddressSchema,
    letter_type: LetterType,
});
export type SendLetterInput = z.infer<typeof SendLetterInputSchema>;

export const SendPostcardInputSchema = z.object({
    to: AddressSchema,
    from_: AddressSchema,
    postcard_type: PostcardType,
});
export type SendPostcardInput = z.infer<typeof SendPostcardInputSchema>;

function getClick2mailBasicAuthHeader(): HeadersInit {
    return {
       "Authorization": `Basic dGVzdFByaW9yaXR5OkppdmF0ZWFtMTIzNA==`,
       "Accept": "application/json"
   };
}

// Helper function to get Bearer Auth header for EasyPost
function getEasyPostAuthHeader(): HeadersInit {
   const EASYPOST_API_KEY = env.EASYPOST_API_KEY;
   if (!EASYPOST_API_KEY) {
       throw new Error("Missing EasyPost API key in environment");
   }
   return {
       "Authorization": `Bearer ${EASYPOST_API_KEY}`,
       "Content-Type": "application/json",
   };
}


// Define our MCP agent with tools
export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "Click2mail",
        version: "1.0.0", // You might want to specify a version
    });

    async init() {
        // Define Tools

        this.server.tool(
            "create_shipping_label",
            z.object({
                to_address_name: z.string(),
                to_address_street1: z.string(),
                to_address_city: z.string(),
                to_address_state: z.string(),
                to_address_zip: z.string(),
                to_address_country: z.string(),
                from_address_name: z.string(),
                from_address_street1: z.string(),
                from_address_city: z.string(),
                from_address_state: z.string(),
                from_address_zip: z.string(),
                from_address_country: z.string(),
                parcel_weight: z.string(),
            }),
            async (input) => {
                // TODO: Implement create_shipping_label logic here based on Python code
                // This should call the EasyPost API as in the original Python function.
                const url = "https://api.easypost.com/v2/shipments";
                const headers = getEasyPostAuthHeader();

                const payload = {
                    shipment: {
                        to_address: {
                            name: input.to_address_name,
                            street1: input.to_address_street1,
                            city: input.to_address_city,
                            state: input.to_address_state,
                            zip: input.to_address_zip,
                            country: input.to_address_country,
                            // Add phone and email if required by EasyPost API and available
                            // phone: "9234567890",
                            // email: "support@easypost.com"
                        },
                        from_address: {
                            name: input.from_address_name,
                            street1: input.from_address_street1,
                            city: input.from_address_city,
                            state: input.from_address_state,
                            zip: input.from_address_zip,
                            country: input.from_address_country,
                            // Add phone and email if required by EasyPost API and available
                            // phone: "9234567890",
                            // email: "support@easypost.com"
                        },
                        parcel: {
                            weight: parseFloat(input.parcel_weight) // Convert weight to number if needed
                        },
                        // TODO: Service and carrier_accounts might need to be inputs or configured
                        service: "Priority",
                        carrier_accounts: this.env.EASYPOST_CARRIER_ACCOUNT_ID ? [this.env.EASYPOST_CARRIER_ACCOUNT_ID] : undefined // Use array if multiple accounts
                    }
                };

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload),
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const labelUrl = data?.postage_label?.label_url;

                    if (labelUrl) {
                        return { content: [{ type: "text", text: labelUrl }] };
                    } else {
                        return { content: [{ type: "text", text: "Label URL not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error creating shipping label:", error);
                    return { content: [{ type: "text", text: `Error creating shipping label: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "view_proof",
            "Gets the proof PDF for a given job ID. Use this when the user requests proof for a job.",
            z.object({
                jobid: z.string(),
            }),
            async ({ jobid }) => {
                
                console.log("Job id", jobid);
                const url = `https://stage-rest.click2mail.com/molpro/jobs/1128459/proof`;
                const headers = getClick2mailBasicAuthHeader();
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        // fetch API doesn't have a direct timeout, consider using a library or AbortController
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        // Handle HTTP errors
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const statusUrl = data?.statusUrl;

                    if (statusUrl) {
                        return { content: [{ type: "text", text: statusUrl }] };
                    } else {
                        // Handle cases where statusUrl is not in the response
                        return { content: [{ type: "text", text: "Status URL not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error viewing proof:", error);
                    return { content: [{ type: "text", text: `Error viewing proof: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "job_status",
            z.object({
                jobid: z.string(),
            }),
            async (input) => {
                const url = `https://stage-rest.click2mail.com/molpro/jobs/1128459`;
                const headers = getClick2mailBasicAuthHeader();

                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                        // timeout: 30000
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const description = data?.description;

                    if (description) {
                        return { content: [{ type: "text", text: description }] };
                    } else {
                        return { content: [{ type: "text", text: "Job description not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error getting job status:", error);
                    // Returning null/undefined as in Python example on error
                    return { content: [{ type: "text", text: `Error getting job status: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "check_balance",
            z.object({}), // No arguments
            async () => {
                // TODO: Implement check_balance logic here based on Python code
                // This should make an HTTP request to the Click2mail credit endpoint.
                const url = `https://stage-rest.click2mail.com/molpro/credit`;
                const headers = getClick2mailBasicAuthHeader();

                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                        // timeout: 30000
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const balance = data?.balance;

                    if (balance !== undefined) { // Check for undefined as balance could be 0 or null
                         return { content: [{ type: "text", text: `Available balance: ${balance}` }] };
                    } else {
                         return { content: [{ type: "text", text: "Balance information not found in response." }] };
                    }

                } catch (error: any) {
                    console.error("Error checking balance:", error);
                     return { content: [{ type: "text", text: `Error checking balance: ${error.message}` }] };
                }
            }
        );

        this.server.tool(
            "send_letter",
            z.object({
                pdf_file: z.string(),
                letter_type: z.string(),
                name: z.string(),
                address_lines: z.string(),
                locality: z.string(),
                postal_code: z.string(),
                region_code: z.string().default('US'),
            }),
            async (input) => {
                // TODO: Implement send_letter logic here based on Python code
                // This should handle sending the letter via the third-party API.
                console.log("send_letter tool called with input:", input);
                return { content: [{ type: "text", text: `Placeholder for send letter status and job ID` }] };
            }
        );

        this.server.tool(
            "send_postcard",
            z.object({
                input: SendPostcardInputSchema,
                // Note: Handling file uploads in TypeScript MCP might require a different approach
                // compared to FastAPI's UploadFile. This is a placeholder.
                pdf: z.any(), // Placeholder for file upload
            }),
            async (input) => {
                // TODO: Implement send_postcard logic here based on Python code
                // This should handle sending the postcard via the third-party API.
                console.log("send_postcard tool called with input:", input);
                return { content: [{ type: "text", text: `Placeholder for send postcard status` }] };
            }
        );

        this.server.tool(
            "validate_address",
            z.object({
                address: z.string(),
                city: z.string(),
                state: z.string(),
                zip: z.string(),
                region_code: z.string().default('US'),
            }),
            async ({address, city, state, zip, region_code}) => {
                // TODO: Implement validate_address logic here based on Python code
                // This should call the Google Address Validation API.
                const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
                 if (!GOOGLE_API_KEY) {
                     return { content: [{ type: "text", text: "Google API Key for address validation is not configured." }] };
                 }

                const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${GOOGLE_API_KEY}`;

                const payload = {
                    address: {
                        addressLines: [address], // Address lines should be an array
                        locality: city,
                        postalCode: zip,
                        regionCode: region_code,
                        administrativeArea: state,
                    },
                    enableUspsCass: true // Hardcoded in Python
                };

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`Address validation failed: HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }

                    const data: any = await response.json();
                    const verdict = data?.result?.verdict;
                    const is_valid = verdict?.hasUnconfirmedComponents === false && verdict?.hasInferredComponents === false;

                    const corrected = data?.result?.address;
                    const messages = data?.result?.validationMessages?.map((msg: any) => msg.text) || [];

                    const validationResult: AddressValidationResult = {
                        is_valid: is_valid,
                        corrected_address: corrected || {},
                        original_address: payload.address,
                        messages: messages,
                    };

                    return { content: [{ type: "json", json: validationResult }] };

                } catch (error: any) {
                     console.error("Error validating address:", error);
                     return { content: [{ type: "text", text: `Error validating address: ${error.message}` }] };
                }
            }
        );
    }
}

// Example serving block (adjust paths as needed)
export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
}; 
