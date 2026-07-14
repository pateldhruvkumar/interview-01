import { generateText, stepCountIs, tool } from "ai";
import { Page } from "playwright";
import { z } from "zod";
import { model } from "./_internal/setup";
import { createSession } from "./session";


// This function verifies the submission by checking for the success toast.
async function verifySubmission(page: Page) {
  const success = page.getByText("Form submitted successfully!", { exact: false });

  try {
    await success.waitFor({ state: "visible", timeout: 8000 });
    const heading = (await success.textContent())?.trim() ?? "";
    const detail =
      (await page.getByText("Your medical information has been saved.").textContent())?.trim() ?? "";
    return { verified: true as const, evidence: [heading, detail].filter(Boolean).join(" — ") };
  } catch {
    return { verified: false as const, evidence: "No success confirmation appeared on the page." };
  }
}

export async function main() {
  // Launches Chromium and navigates to the form. `page` is our Playwright handle.
  const page = await createSession("https://magical-medical-form.netlify.app/");

  // This is the tools that the model can use to interact with the page.
  const tools = {
    readForm: tool({
      description:
        "Read every form field on the page. Returns each field's label, id, name, type and current value.",
      inputSchema: z.object({}),
      execute: async () => {
        const fields = await page.$$eval("input, select, textarea", (els) =>
          els.map((el) => {
            const field = el as HTMLInputElement;
            const label =
              document.querySelector(`label[for="${field.id}"]`)?.textContent?.trim() ?? "";
            return {
              label,
              id: field.id,
              name: field.name,
              type: field.type,
              value: field.value,
            };
          })
        );
        return { fields };
      },
    }),

    // This tool is used to fill a field on the page.
    fillField: tool({
      description: "Enter a value into a form field selected by CSS selector (e.g. '#firstName').",
      inputSchema: z.object({
        selector: z.string().describe("CSS selector, e.g. '#firstName'"),
        value: z.string().describe("Value to type into the field"),
      }),
      execute: async ({ selector, value }) => {
        await page.fill(selector, value);
        return { ok: true, selector, value };
      },
    }),

    // This tool is used to click a button on the page.
    clickButton: tool({
      description: "Click a button by its visible text, e.g. 'Submit'.",
      inputSchema: z.object({
        text: z.string().describe("Visible text of the button"),
      }),
      execute: async ({ text }) => {
        await page.getByRole("button", { name: text }).click();
        return { ok: true, clicked: text };
      },
    }),
  };

  const result = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(15),
    system:
      "You fill out web forms. First call readForm to see the fields. " +
      "Match each piece of data to the correct field using its label, then call fillField for each one. " +
      "When every field is filled, click the Submit button. Never invent fields that don't exist.",
    prompt:
      "Fill out the patient intake form:\n" +
      "- First Name: John\n" +
      "- Last Name: Doe\n" +
      "- Date of Birth: 1990-01-01\n" +
      "- Medical ID: 91927885\n" +
      "Then submit the form.",
  });
  console.log("Agent's own summary:\n", result.text);

  // The *ground truth* — what the page actually shows.
  const check = await verifySubmission(page);
  if (check.verified) {
    console.log(`\n VERIFIED: ${check.evidence}`);
  } else {
    console.error(`\nNOT VERIFIED: ${check.evidence}`);
    process.exitCode = 1;
  }
}