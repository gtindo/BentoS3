import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { JsonDashboardStore } from "../src/dashboard/json-dashboard-store.js";
import { BentoS3 } from "../src/index.js";

test("covers dashboard authentication, buckets, objects, credentials, and assets", async ({
  page,
  request,
}) => {
  const rootDir = await createTempRootDir();
  const dashboardStore = new JsonDashboardStore({ rootDir });
  await dashboardStore.createUser({ username: "admin", password: "correct-password" });

  const server = new BentoS3({ auth: { enabled: false }, port: 0, rootDir });
  await server.start();

  try {
    const endpoint = readEndpoint(server);

    await page.goto(`${endpoint}/ui/buckets`);
    await expect(page).toHaveURL(`${endpoint}/ui/login`);

    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid username or password.")).toBeVisible();

    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("correct-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${endpoint}/ui/buckets`);
    await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("Buckets");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Buckets");

    const cookies = await page.context().cookies(`${endpoint}/ui`);
    const sessionCookie = cookies.find((cookie) => cookie.name === "bentos3_session");
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");

    const cssResponse = await request.get(`${endpoint}/ui/static/app.css`);
    expect(cssResponse.status()).toBe(200);
    expect(await cssResponse.text()).toContain(".card");

    const turboResponse = await request.get(`${endpoint}/ui/static/turbo.js`);
    expect(turboResponse.status()).toBe(200);
    expect(await turboResponse.text()).toContain("Turbo");
    const turboVendorResponse = await request.get(
      `${endpoint}/ui/static/vendor/turbo.es2017-esm.js`,
    );
    expect(turboVendorResponse.status()).toBe(200);
    expect(await turboVendorResponse.text()).toContain("Turbo 8");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((Reflect.get(window, "Turbo") as { session?: unknown }).session),
        ),
      )
      .toBe(true);

    const turboProbe = await page.evaluate(() => {
      Reflect.set(window, "__bentoTurboProbe", String(Date.now()));

      return Reflect.get(window, "__bentoTurboProbe") as string;
    });

    await page.getByRole("link", { name: "New bucket" }).click();
    await expect(page).toHaveURL(`${endpoint}/ui/buckets/new`);
    await expect
      .poll(() =>
        page.evaluate<string>(() => String(Reflect.get(window, "__bentoTurboProbe") ?? "")),
      )
      .toBe(turboProbe);
    await page.getByPlaceholder("bucket-name").fill("ui-e2e-bucket");
    await page.getByRole("button", { name: "Create bucket" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ui-e2e-bucket" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
      "ui-e2e-bucket",
    );
    await expect(stat(join(rootDir, ".bentos3", "buckets", "ui-e2e-bucket"))).resolves.toBeTruthy();

    await page.getByPlaceholder("object/key.txt").fill("folder/example.txt");
    await page.getByPlaceholder("Object body").fill("hello dashboard");
    await page.getByRole("button", { name: "Upload object" }).click();
    await expect(page.getByRole("link", { name: "folder/example.txt" })).toBeVisible();
    await expect(
      stat(join(rootDir, ".bentos3", "buckets", "ui-e2e-bucket", "folder", "example.txt")),
    ).resolves.toBeTruthy();

    await page.getByLabel("Upload file").setInputFiles({
      name: "file-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello file upload"),
    });
    await page.getByRole("button", { name: "Upload object" }).click();
    await expect(page.getByRole("link", { name: "file-upload.txt" })).toBeVisible();
    await expect(
      readFile(join(rootDir, ".bentos3", "buckets", "ui-e2e-bucket", "file-upload.txt"), "utf8"),
    ).resolves.toBe("hello file upload");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "folder/example.txt" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("example.txt");

    await page.goto(`${endpoint}/ui/credentials`);
    await page.getByRole("link", { name: "New credential" }).click();
    await page.getByPlaceholder("Access key ID, optional").fill("ui-access-key");
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByText("Copy this secret now.")).toBeVisible();
    await page.getByRole("link", { name: "Back to credentials" }).click();
    await expect(page.getByText("ui-access-key")).toBeVisible();

    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("cell", { name: "Disabled" })).toBeVisible();

    await page.goto(`${endpoint}/ui/buckets`);
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("The bucket you tried to delete is not empty.")).toBeVisible();

    await page.goto(`${endpoint}/ui/buckets/ui-e2e-bucket`);
    await page
      .getByRole("row", { name: /folder\/example\.txt/ })
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("row", { name: /file-upload\.txt/ })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByRole("heading", { name: "No objects yet" })).toBeVisible();

    await page.goto(`${endpoint}/ui/buckets`);
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("ui-e2e-bucket")).not.toBeVisible();

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page).toHaveURL(`${endpoint}/ui/login`);
  } finally {
    await server.stop();
  }
});

async function createTempRootDir(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "bentos3-ui-e2e-"));
  const rootDir = join(parent, "root");

  await mkdir(rootDir);

  return rootDir;
}

function readEndpoint(server: BentoS3): string {
  if (!server.endpoint) {
    throw new Error("Server must expose an endpoint after startup.");
  }

  return server.endpoint;
}
