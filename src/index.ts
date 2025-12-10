import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "cloudflare:workers";

type Env = { GOOGLE_API_KEY?: string; }; 


type ExecutionContext = any;



// Define Models using Zod
export const AddressSchema = z.object({
    name: z.string(),
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
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


// Define a type for your custom props for type safety
interface CustomProps {
    toolExecutionApiKey?: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env, unknown, CustomProps> {
    getClick2mailBasicAuthHeader(): HeadersInit {
        
        // 🛑 Retrieve the key from the context properties (`this.props`)
        const apiKey = this.props.toolExecutionApiKey;
        
        if (!apiKey) {
            console.error("TOOL_EXECUTION_API_KEY is missing in props.");
            // You should throw an error or handle the missing key
            throw new Error("Authentication Failed 1: Missing tool API key.");
        }
        
        // Use the apiKey to create the Basic Authorization header
        // NOTE: Basic auth requires the value to be base64-encoded, typically "username:password"
        // Ensure you are base64-encoding the value if that's what Click2Mail expects.
        // If your 'mcp_token' is already the full base64 string, use it directly.
        
        return {
           "Authorization": `Basic ${apiKey}`,
           "Accept": "application/json"
        };
    }

    server = new McpServer({
        name: "Click2mail",
        version: "1.0.0", 
    });

    async init() {
        // Define Tools
        this.server.tool(
            "job_status",
            "Check status of job",
            {	
				jobid: z.string(),	
			},            
            async ({jobid}) => {
                const url = `https://stage-rest.click2mail.com/molpro/jobs/${jobid}`;


                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: this.getClick2mailBasicAuthHeader(),
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
            "correct_address",
            "Corrects and standardizes an address using Click2Mail's address correction service.",
            {   
                // Input parameters for the POST /correctAddress endpoint
                address1: z.string().describe("Primary address line (e.g., street address and house number)."),
                address2: z.string().optional().describe("Secondary address line (e.g., apartment number, suite)."),
                city: z.string().describe("City name."),
                state: z.string().describe("State or province abbreviation."),
                zip: z.string().describe("ZIP code or postal code."),
                country: z.string().optional().describe("Country name (defaults to 'US' if omitted by the API)."),
            },            
            async ({address1, address2, city, state, zip, country}) => {
                const url = `https://stage-rest.click2mail.com/molpro/correctAddress`;
        
                // Construct the request body
                const requestBody = {
                    address1: address1,
                    address2: address2 || undefined, // Include only if provided
                    city: city,
                    state: state,
                    zip: zip,
                    country: country || undefined, // Include only if provided
                };
        
                try {
                    const response = await fetch(url, {
                        method: 'POST', // Use POST for correctAddress
                        headers: {
                            ...this.getClick2mailBasicAuthHeader(),
                            'Content-Type': 'application/json', // Specify content type for JSON body
                        },
                        body: JSON.stringify(requestBody),
                        // timeout: 30000
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        // Throwing an error for non-200 responses
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // The API returns the corrected address object, which you can return as a JSON string or formatted text.
                    const correctedAddressString = JSON.stringify(data, null, 2);
        
                    if (data && Object.keys(data).length > 0) {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Address corrected successfully. Corrected address details:\n${correctedAddressString}` 
                            }] 
                        };
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: "Address correction failed or returned an empty response." 
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error correcting address:", error);
                    // Return an error message to the user
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error correcting address: ${error.message}` 
                        }] 
                    };
                }
            }
        );

        this.server.tool(
            "get_documents",
            "Retrieve list of documents from Click2Mail account",
            {
                limit: z.number().optional().describe("Maximum number of documents to return (default: 50, max: 100)"),
                offset: z.number().optional().describe("Number of documents to skip for pagination (default: 0)"),
            },
            async ({ limit, offset }) => {
                // Build query parameters
                const params = new URLSearchParams();
                if (limit !== undefined) {
                    params.append('limit', Math.min(limit, 100).toString());
                }
                if (offset !== undefined) {
                    params.append('offset', offset.toString());
                }
                
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/documents${queryString ? '?' + queryString : ''}`;
        
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: this.getClick2mailBasicAuthHeader(),
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // Format the response for better readability
                    if (data && Array.isArray(data)) {
                        const documentList = data.map((doc: any) => ({
                            id: doc.id,
                            name: doc.documentName,
                            status: doc.status,
                            pages: doc.pages,
                            created: doc.createdDate,
                        }));
                        
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Found ${documentList.length} documents:\n${JSON.stringify(documentList, null, 2)}` 
                            }] 
                        };
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: JSON.stringify(data, null, 2) 
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error retrieving documents:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error retrieving documents: ${error.message}` 
                        }] 
                    };
                }
            }
        );

        this.server.tool(
            "get_cost_estimate",
            "Get cost estimate for a mailing job",
            {
                productClass: z.enum([
                    "Postcard 5 x 8",
                    "Postcard 6 x 11",
                    "Postcard 3.5 x 5",
                    "Postcard 4.25 x 6",
                    "Postcard 4 x 9",
                    "Postcard 6 x 9",
                    "Notecard Folded 4.25 x 5.5",
                    "Notecard 4.25 x 5.5",
                    "Notecard Folded 5 x 6.5",
                    "Rack Card 4 x 9",
                    "Flyer 8.5 x 11",
                    "Brochure 11 x 8.5",
                    "Letter 8.5 x 11",
                    "Letter 8.5 x 14",
                    "Secure Self Mailer",
                    "Booklet Self Mailer 8.5 x 11",
                    "Booklet 8.5 x 11 Address Back Page",
                    "Booklet 8.5 x 11 Address Front Page",
                    "Reply Letter 8.5 x 11",
                    "Reply Mail Postcard 4.25 x 6",
                    "Certified Letter 8.5 x 14",
                    "Certified Letter 8.5 x 11",
                    "Certified Self Mailer 8.5 x 11",
                    "Certified Self Mailer - Green Card",
                    "Priority Letter 8.5 x 11",
                    "Priority Mail Letter 8.5 x 11 With UMC Envelope",
                    "Priority Mail Express Letter 8.5 x 11",
                    "EDDM Mailer 6.5 x 9",
                    "EDDM Mailer 8.5 x 12",
                    "EDDM Mailer 8.5 x 11",
                    "EDDM Mailer 6.25 x 11",
                    "Shipped Postcard 3.5 x 5",
                    "Shipped Postcard 4.25 x 6",
                    "Shipped Postcard 5 x 8",
                    "Shipped Postcard 6 x 11",
                    "Shipped Cardstock folded 12 x 4.5",
                    "Shipped Postcard 6.5 x 9",
                    "Shipped Flyer - folded",
                    "Shipped Brochure",
                    "Shipped Postcard 4 x 9",
                    "Shipped Rack Card 4 x 9",
                    "Certified Reply Letter Addr First Page",
                    "Certified Letter Address First Page",
                    "Certified Letter Radiation Warning",
                    "Letter 8.5 x 11 Reply Envelope - Labels",
                    "Letter 8.5 x 11 2 Reply Envelopes - Labels",
                ]).describe("Product class"),
                layout: z.enum([
                    "Address on First Page",
                    "Address on Separate Page",
                    "Address Back Page",
                    "Self Mailer",
                    "Self Mailer with Return Reciept",
                    "Courtesy Reply Letter",
                    "Courtesy Reply Postcard",
                    "Business Reply Postcard",
                    "Double Sided Postcard",
                    "Single Sided Postcard",
                    "Easy Letter Postcard",
                    "Easy Letter ",
                    "Picture and Address First Page",
                    "Picture Postcard",
                    "Email to Mail",
                    "You Prep & Mail Locally",
                    "We Prep & You Mail Locally",
                    "We Prep & Mail",
                    "Address on Envelope",
                    "Folded Double Postcard",
                    "Note Card in A7 Envelope",
                    "Address on First Page  - FR",
                    "Address on First Page  - UK",
                    "Address on First Page  - ES",
                    "Address on First Page  - DE",
                    "Folded Double Postcard  - IN",
                    "Address on First Page  - IT",
                    "Address on First Page  - BR",
                    "Address on First Page  - AU",
                    "Same as a Stamp",
                    "Vertical Split Postcard",
                    "Self Mailer with Message Area on Address Panel",
                    "Address on First Page  - CN",
                    "Address on First Page - MX",
                    "Address on First Page  - AT",
                    "Address on First Page  - CH",
                    "Lightpost Spacesaver Postcard",
                    "Lightpost Picture Postcard",
                    "Lightpost Vertical Split Postcard",
                    "Address on First Page  - HK",
                    "Address on First Page  - TW",
                    "Address on First Page  - CA",
                    "Flyer",
                    "Brochure",
                    "Brochure with Message Area on Address Panel",
                    "Portrait Double Sided Postcard",
                    "You Prep and Mail Locally",
                    "We Prep and You Mail Locally",
                    "We Prep and Mail",
                    "Folded Double Postcard  - USA BP",
                    "Folded Double Postcard  - IN BP",
                    "Portrait Single Sided Postcard",
                    "Portrait Picture Postcard",
                    "Portrait Vertical Split Postcard",
                    "Rack Card",
                    "Notecard - Folded",
                    "Notecard -Single Sided",
                    "Secure Self Mailer",
                    "Address on Separate Page w/EQC",
                    "Address on First Page w/EQC",
                    "Picture and Address First Page w/EQC",
                    "Address Back Page w/EQC",
                    "Portrait  Notecard - Folded",
                ]).describe("Layout specification"),
                productionTime: z.enum([
                    "Next Day",
                    "Within 3 Days",
                    "Within 7 days",
                    "Same Day",
                    "Within 5 Days",
                    "Week 1",
                    "Week 2",
                    "Week 3",
                    "Week 4",
                    "Week 5",
                    "Week 6",
                    "Week 7",
                    "Week 8",
                    "Week 9",
                    "Week 10",
                    "Week 11",
                    "Week 12",
                    "Week 13",
                    "Week 14",
                    "Week 15",
                    "Week 16",
                ]).describe("Production time"),
                mailingClass: z.enum([
                    "First Class",
                    "Standard",
                    "Certified Mail",
                    "Cert. w/electronic return receipt",
                    "Cert. w/rtn. and restricted delivery",
                    "Certified Mail w/return receipt",
                    "Priority Mail with Delivery Confirmation",
                    "Priority Mail with Signature Confirmation",
                    "Postage Paid Locally - by You",
                    "G10",
                    "Non Profit",
                    "Priority",
                    "Economy",
                    "Recommandee",
                    "Recommandee w/electronic return receipt",
                    "International",
                    "Postage Paid in Advance",
                    "First Class Unsorted Letter w/Certificate of Mailing",
                    "First Class UK",
                    "Standard Class UK",
                    "International UK",
                    "International IN",
                    "Priority Mail Express with Signature Required",
                    "Priority Mail Express No Signature Required",
                    "Priority Mail Flat Rate Box with Delivery Confirmation",
                    "Priority Mail Flat Rate Box with Signature Confirmation",
                    "First Class Live Stamp",
                    "First Class Specialty Stamp",
                    "First Class No Move Update",
                    "Certified Mail No Move Update",
                    "Non Profit Paid in Advance",
                    "Cert. w/ERR No Move Update",
                ]).describe("Mailing class"),
                color: z.enum(["Full Color", "Black and White"]).describe("Color printing (Full Color or Black and White)"),
                printOption: z.enum(["Printing One side", "Printing Both sides"]).describe("Double-sided printing"),
                paperType: z.enum([
                    "White Matte with Gloss UV Finish",
                    "White Matte",
                    "White 24#",
                    "Off-White 28#",
                    "Canary 24#",
                    "White 28#",
                    "Yellow 65# Uncoated",
                    "Green 65# Uncoated",
                    "100# White with UV Coating",
                    "High Quality Paper",
                    "Postcard Stock",
                    "White Postcard Stock",
                    "White 22#",
                    "100# White Matte",
                    "Premium Quality Letter Paper",
                    "Premium Quality Letter Paper - Ivory",
                    "Premium Quality Letter Paper - White",
                    "White Matte with Gloss UV Finish – MS",
                    "Premium Quality Card Paper - Ivory",
                    "Premium Quality Card Paper - White",
                    "100# White Gloss",
                    "Printers Choice",
                    "120# White Matte",
                    "Pink 65# Uncoated",
                    "White Uncoated",
                    "White w/Gray Security Tint",
                    "120# White Uncoated",
                    "White 28# Matte",
                ]).describe("Paper type specification"),
                envelope: z.enum([
                    "#10 Double Window",
                    "Flat Envelope",
                    "#10 Eco-Envelope - CRM",
                    "Flat Rate USPS Priority Mail ",
                    "DL Single Window",
                    "DL Double Window",
                    "C4 Envelope",
                    "DL Envelope",
                    "#10 Open Window Envelope",
                    "Certified Mail Letter Envelope",
                    "Certified Mail Flat Envelope",
                    "None - Self Mailer",
                    "Premium Quality #10 Envelope",
                    "Premium Quality #10 Envelope - White",
                    "Premium Quality #10 Envelope - Ivory",
                    "Premium Quality A7 Envelope - Ivory",
                    "Premium Quality A7 Envelope - White",
                    "C5 Envelope",
                    "C6 Envelope",
                    "DLX Envelope",
                    "E65 Envelope",
                    "#10 Single Window",
                    "Certified Mail 6 x 9.5 Envelope",
                    "Flat Rate USPS Priority Mail Express ",
                    "Priority Flat Rate Box",
                    "A2 White Open Window",
                    "Best Fit",
                    "6 x 9.5 Open Window",
                    "6 x 9.5 Double Window",
                    "Address Printed On Envelope",
                    "Flat Rate USPS Priority Mail UMC",
                ]).describe("Envelope specification"),
                numberOfPages: z.number().optional().describe("Number of pages in the document"),
            },
            async ({ numberOfPages, productClass, layout, envelope, productionTime, mailingClass, color, printOption, paperType }) => {
                

                const params = new URLSearchParams();
                params.append('documentClass', productClass);
                params.append('layout', layout);
                params.append('productionTime', productionTime);
                params.append('mailClass', mailingClass);
                params.append('envelope', envelope);
                params.append('color', color);
                params.append('paperType', paperType);
                params.append('printOption', printOption);
                if (numberOfPages !== undefined) {
                    params.append('numberOfPages', numberOfPages.toString());
                }
             
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/costEstimate${queryString ? '?' + queryString : ''}`;

                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            ...this.getClick2mailBasicAuthHeader(),
                            'Content-Type': 'application/json',
                        }
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Cost Estimate:\n${JSON.stringify(data, null, 2)}` 
                        }] 
                    };
        
                } catch (error: any) {
                    console.error("Error getting cost estimate:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error getting cost estimate: ${error.message}` 
                        }] 
                    };
                }
            }
        );

        this.server.tool(
            "get_projects",
            "Retrieve list of projects from Click2Mail account",
            {
                limit: z.number().optional().describe("Maximum number of projects to return (default: 50, max: 100)"),
                offset: z.number().optional().describe("Number of projects to skip for pagination (default: 0)"),
            },
            async ({ limit, offset }) => {
                // Build query parameters
                const params = new URLSearchParams();
                if (limit !== undefined) {
                    params.append('limit', Math.min(limit, 100).toString());
                }
                if (offset !== undefined) {
                    params.append('offset', offset.toString());
                }
                
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/projects${queryString ? '?' + queryString : ''}`;
        
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: this.getClick2mailBasicAuthHeader(),
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // Format the response for better readability
                    if (data && Array.isArray(data)) {
                        const projects = data.map((project: any) => ({
                            id: project.id,
                            name: project.projectName,
                            description: project.description,
                            status: project.status,
                            created: project.createdDate,
                            modified: project.modifiedDate,
                        }));
                        
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Found ${projects.length} projects:\n${JSON.stringify(projects, null, 2)}` 
                            }] 
                        };
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: JSON.stringify(data, null, 2) 
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error retrieving projects:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error retrieving projects: ${error.message}` 
                        }] 
                    };
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
                const url = `https://stage-rest.click2mail.com/molpro/jobs/${jobid}/proof`;
                
                
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: this.getClick2mailBasicAuthHeader(),
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
            "get_address_lists",
            "Retrieve address/mailing lists from Click2Mail account",
            {
                limit: z.number().optional().describe("Maximum number of address lists to return (default: 50, max: 100)"),
                offset: z.number().optional().describe("Number of address lists to skip for pagination (default: 0)"),
            },
            async ({ limit, offset }) => {
                // Build query parameters
                const params = new URLSearchParams();
                if (limit !== undefined) {
                    params.append('limit', Math.min(limit, 100).toString());
                }
                if (offset !== undefined) {
                    params.append('offset', offset.toString());
                }
                
                const queryString = params.toString();
                const url = `https://stage-rest.click2mail.com/molpro/addressLists${queryString ? '?' + queryString : ''}`;
        
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: this.getClick2mailBasicAuthHeader(),
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // Format the response for better readability
                    if (data && Array.isArray(data)) {
                        const addressLists = data.map((list: any) => ({
                            id: list.id,
                            name: list.addressListName,
                            addressCount: list.addressCount,
                            created: list.createdDate,
                            modified: list.modifiedDate,
                        }));
                        
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Found ${addressLists.length} address lists:\n${JSON.stringify(addressLists, null, 2)}` 
                            }] 
                        };
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: JSON.stringify(data, null, 2) 
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error retrieving address lists:", error);
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error retrieving address lists: ${error.message}` 
                        }] 
                    };
                }
            }
        );

        this.server.tool(
            "get_account_addresses",
            "Retrieves a list of addresses associated with the account, optionally filtered by address type.",
            {   
                // addressType is optional for filtering
                addressType: z.enum([
                    "Return address",
                    "Billing address",
                    "Business reply",
                    "Courtesy reply address",
                    "EDDM Mailer address"
                ]).required().describe("Optional filter to retrieve addresses of a specific type."),
            },            
            async ({addressType}) => {
                // Base URL for the account addresses endpoint
                let url = `https://stage-rest.click2mail.com/molpro/account/addresses`;
        
                // If an addressType is provided, append it as a query parameter
                if (addressType) {
                    // Note: addressType needs to be URL-encoded, especially since it contains spaces
                    const encodedAddressType = encodeURIComponent(addressType);
                    url += `?addressType=${encodedAddressType}`;
                }
        
                try {
                    const response = await fetch(url, {
                        method: 'GET', // Use GET for retrieval
                        headers: this.getClick2mailBasicAuthHeader(),
                        // timeout: 30000
                    });
        
                    if (!response.ok) {
                        const errorBody = await response.text();
                        // Throwing an error for non-200 responses
                        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                    }
        
                    const data: any = await response.json();
                    
                    // The API is expected to return an array of address objects
                    if (Array.isArray(data) && data.length > 0) {
                        // Return the list of addresses, either as a formatted string or the JSON
                        const addressCount = data.length;
                        const addressesSummary = data.map((addr: any, index: number) => 
                            `  ${index + 1}. ID: ${addr.addressId}, Type: ${addr.addressType}, Address1: ${addr.address1}`
                        ).join('\n');
        
                        const filterInfo = addressType ? ` for type "${addressType}"` : "";
        
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `${addressCount} account address(es) retrieved${filterInfo}:\n${addressesSummary}\n\nFull JSON: ${JSON.stringify(data, null, 2)}` 
                            }] 
                        };
                    } else if (Array.isArray(data) && data.length === 0) {
                         const filterInfo = addressType ? ` for type "${addressType}"` : "";
                         return {
                             content: [{
                                 type: "text",
                                 text: `No account addresses found${filterInfo}.`
                             }]
                         }
                    } else {
                        return { 
                            content: [{ 
                                type: "text", 
                                text: `Failed to retrieve addresses or response format was unexpected. Response: ${JSON.stringify(data)}`
                            }] 
                        };
                    }
        
                } catch (error: any) {
                    console.error("Error retrieving account addresses:", error);
                    // Return an error message to the user
                    return { 
                        content: [{ 
                            type: "text", 
                            text: `Error retrieving account addresses: ${error.message}` 
                        }] 
                    };
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
                const headers = this.getClick2mailBasicAuthHeader();

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


    
    }
}

// Example serving block (adjust paths as needed)
export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        const apiKey = request.headers.get('mcp_token');
         
            if (!apiKey) {
                // If this logs, the client isn't sending the header.
                console.error("[DEBUG] Client did not send 'mcp_token' header.");
                return new Response("Missing mcp_token header.", { status: 401 }); 
            }
            ctx.props = {
                ...ctx.props, // Preserve any existing props
                toolExecutionApiKey: apiKey, // Use a descriptive, camelCase key
            };
       

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
}; 
