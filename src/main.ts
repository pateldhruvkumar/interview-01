import { generateText, stepCountIs, tool } from "ai";
import { Page } from "playwright";
import { z } from "zod";
import { model } from "./_internal/setup";
import { createSession } from "./session";

export type PatientData = {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // Date format: "YYYY-MM-DD"
  medicalId: string;
  gender: string; // matches a Gender dropdown option
  bloodType: string; // matches a Blood Type dropdown option
  allergies: string;
  medications: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export const defaultPatient: PatientData = {
  firstName: "John",
  lastName: "Doe",
  dateOfBirth: "1990-01-01",
  medicalId: "91927885",
  gender: "Male",
  bloodType: "O+",
  allergies: "Penicillin",
  medications: "None",
  emergencyContactName: "Jane Doe",
  emergencyContactPhone: "555-123-4567",
};


// This function verifies the submission by checking for the success toast.
async function verifySubmission(page: Page) {
  const success = page.getByText("Form submitted successfully", { exact: false });

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

export async function main(patient: PatientData = defaultPatient) {
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
              const options = el.tagName === "SELECT"
              ? [...(el as HTMLSelectElement).options].map((o) => o.value).filter(Boolean)
              : undefined;
            return {
              label,
              id: field.id,
              name: field.name,
              type: field.type,
              value: field.value,
              options,
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

    // This tool is used to select an option from a dropdown on the page.
    selectDropdown: tool({
      description:
        "Choose an option in a <select> dropdown (Gender, Blood Type). Use instead of " +
        "fillField for dropdowns. Matches option value or visible label.",
      inputSchema: z.object({
        selector: z.string().describe("CSS selector for the <select>, e.g. '#gender'"),
        value: z.string().describe("Option to choose, e.g. 'male' or 'O+'"),
      }),
      execute: async ({ selector, value }) => {
        await page.selectOption(selector, value);
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
    stopWhen: stepCountIs(25),
    system:
    "You fill out a multi-section accordion form. The sections ('Personal Information', " +
    "'Medical Information', 'Emergency Contact') are collapsible: click a section's header " +
    "button to reveal its fields before filling them. The first section is already open. " +
    "Only one section is open at a time, but entered data is preserved when a section collapses. " +
    "For each section: expand it if needed, call readForm, then fill every field — fillField for " +
    "text/date/textarea, selectDropdown for <select> dropdowns. Only use option values readForm " +
    "reported. After all three sections are complete, click Submit.",
    prompt:
    "Fill out the entire form across all three sections:\n\n" +
    "Personal Information:\n" +
    `- First Name: ${patient.firstName}\n` +
    `- Last Name: ${patient.lastName}\n` +
    `- Date of Birth: ${patient.dateOfBirth}\n` +
    `- Medical ID: ${patient.medicalId}\n\n` +
    "Medical Information:\n" +
    `- Gender: ${patient.gender}\n` +
    `- Blood Type: ${patient.bloodType}\n` +
    `- Allergies: ${patient.allergies}\n` +
    `- Current Medications: ${patient.medications}\n\n` +
    "Emergency Contact:\n" +
    `- Emergency Contact Name: ${patient.emergencyContactName}\n` +
    `- Emergency Contact Phone: ${patient.emergencyContactPhone}\n\n` +
    "Then submit the form.",
  });
console.log("Agent's own summary:\n", result.text);

  const check = await verifySubmission(page);
  if (check.verified) console.log(`\nVERIFIED: ${check.evidence}`);
  else console.error(`\nNOT VERIFIED: ${check.evidence}`);

  // Close the browser so repeated runs don't pile up Chromium processes.
  await page.context().browser()?.close();

  return { verified: check.verified, evidence: check.evidence, summary: result.text };
}