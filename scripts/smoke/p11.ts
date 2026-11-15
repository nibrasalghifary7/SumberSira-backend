import { startTestServer, request, loginAs, check } from "./_helpers.js";
import { db } from "../../src/lib/db.js";

const PASS_A = "sandiasmoke1";
const PASS_A2 = "sandiasmoke2";
const PASS_A_RESET = "sandireset1";
const EMAIL_A = "petugas-a@smoke.test";
const EMAIL_B = "admin-b@smoke.test";

async function run() {
  console.log("=== Menjalankan Smoke Test P11 ===");
  const { baseUrl, close } = await startTestServer();

  try {
    const { cookie: adminCookie } = await loginAs(baseUrl, "admin");

    // 1. Admin membuat petugas
    const rCreate = await request(baseUrl, "/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: "[SMOKE] Petugas A",
        email: EMAIL_A,
        role: "petugas",
        password: PASS_A,
      }),
    });
    check("Admin POST /admin/staff 201", rCreate.status === 201, `dapat ${rCreate.status}`);
    check("Akun aktif secara default", rCreate.body?.active === true);
    const staffAId = rCreate.body?.id as string;

    // 2. Validasi pembuatan
    const rDup = await request(baseUrl, "/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: "[SMOKE] Duplikat",
        email: EMAIL_A,
        role: "petugas",
        password: PASS_A,
      }),
    });
    check("Email ganda ditolak 409", rDup.status === 409, `dapat ${rDup.status}`);

    const rShortPw = await request(baseUrl, "/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "[SMOKE] Pendek", email: "pendek@smoke.test", role: "petugas", password: "7karak" }),
    });
    check("Password kurang dari 8 ditolak 400", rShortPw.status === 400, `dapat ${rShortPw.status}`);

    const rBadEmail = await request(baseUrl, "/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "[SMOKE] Email Salah", email: "bukan-email", role: "petugas", password: PASS_A }),
    });
    check("Email tidak valid ditolak 400", rBadEmail.status === 400, `dapat ${rBadEmail.status}`);

    // 3. Daftar staff tanpa hash
    const rList = await request(baseUrl, "/admin/staff", { headers: { Cookie: adminCookie } });
    check("Admin GET /admin/staff 200", rList.status === 200);
    check("Daftar berisi akun baru", rList.body?.some((s: any) => s.email === EMAIL_A));
    check("Respons tidak mengandung passwordHash", !JSON.stringify(rList.body).includes("passwordHash"));

    // 4. Petugas bisa login; akses staff ditolak 403
    const loginA = await loginWith(baseUrl, EMAIL_A, PASS_A);
    check("Petugas baru bisa login", loginA.ok);
    check("Petugas mendapat cookie", loginA.cookie.length > 0);

    const rMeA = await request(baseUrl, "/auth/me", { headers: { Cookie: loginA.cookie } });
    check("Petugas /auth/me 200", rMeA.status === 200);

    const rStaffByPetugas = await request(baseUrl, "/admin/staff", {
      headers: { Cookie: loginA.cookie },
    });
    check("Petugas akses /admin/staff ditolak 403", rStaffByPetugas.status === 403, `dapat ${rStaffByPetugas.status}`);

    // 5. Menonaktifkan petugas: sesinya langsung 401, login ditolak
    const rDeactivate = await request(baseUrl, `/admin/staff/${staffAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ active: false }),
    });
    check("Admin menonaktifkan petugas 200", rDeactivate.status === 200 && rDeactivate.body?.active === false);

    const rMeAfterDeactivate = await request(baseUrl, "/auth/me", { headers: { Cookie: loginA.cookie } });
    check("Sesi petugas nonaktif langsung 401", rMeAfterDeactivate.status === 401, `dapat ${rMeAfterDeactivate.status}`);

    const rLoginDeactivated = await loginWith(baseUrl, EMAIL_A, PASS_A);
    check("Petugas nonaktif login 401", !rLoginDeactivated.ok);

    // 6. Tidak bisa menonaktifkan atau menurunkan diri sendiri
    const rMeAdmin = await request(baseUrl, "/auth/me", { headers: { Cookie: adminCookie } });
    const adminId = rMeAdmin.body?.id as string;

    const rSelfDeactivate = await request(baseUrl, `/admin/staff/${adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ active: false }),
    });
    check("Menonaktifkan diri sendiri ditolak 409", rSelfDeactivate.status === 409, `dapat ${rSelfDeactivate.status}`);

    const rSelfDemote = await request(baseUrl, `/admin/staff/${adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ role: "petugas" }),
    });
    check("Menurunkan peran diri sendiri ditolak 409", rSelfDemote.status === 409, `dapat ${rSelfDemote.status}`);

    // 7. Proteksi admin aktif terakhir: buat admin [SMOKE] kedua, boleh diturunkan/nonaktif
    const rCreateB = await request(baseUrl, "/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "[SMOKE] Admin B", email: EMAIL_B, role: "admin", password: PASS_A }),
    });
    check("Admin kedua dibuat 201", rCreateB.status === 201, `dapat ${rCreateB.status}`);
    const staffBId = rCreateB.body?.id as string;

    const rDemoteB = await request(baseUrl, `/admin/staff/${staffBId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ role: "petugas" }),
    });
    check("Menurunkan admin kedua (masih ada admin aktif lain) 200", rDemoteB.status === 200, `dapat ${rDemoteB.status}`);

    const rDeactivateB = await request(baseUrl, `/admin/staff/${staffBId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ active: false }),
    });
    check("Menonaktifkan akun kedua 200", rDeactivateB.status === 200);

    // Menurunkan admin aktif terakhir (diri sendiri, lewat jalur admin terakhir) tetap 409
    const rLastAdmin = await request(baseUrl, `/admin/staff/${adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ active: false }),
    });
    check("Admin aktif terakhir tidak bisa dinonaktifkan 409", rLastAdmin.status === 409, `dapat ${rLastAdmin.status}`);

    // 8. Reset password oleh admin: semua sesi dicabut
    const rReactivate = await request(baseUrl, `/admin/staff/${staffAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ active: true }),
    });
    check("Mengaktifkan kembali petugas 200", rReactivate.status === 200 && rReactivate.body?.active === true);

    const loginA1 = await loginWith(baseUrl, EMAIL_A, PASS_A);
    const loginA2 = await loginWith(baseUrl, EMAIL_A, PASS_A);
    check("Dua sesi petugas terbentuk", loginA1.ok && loginA2.ok);

    const rReset = await request(baseUrl, `/admin/staff/${staffAId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ password: PASS_A_RESET }),
    });
    check("Admin reset password 200", rReset.status === 200);

    const rMeOldSession = await request(baseUrl, "/auth/me", { headers: { Cookie: loginA1.cookie } });
    check("Sesi lama dicabut setelah reset 401", rMeOldSession.status === 401, `dapat ${rMeOldSession.status}`);

    const rLoginOldPw = await loginWith(baseUrl, EMAIL_A, PASS_A);
    check("Login dengan password lama ditolak", !rLoginOldPw.ok);
    const loginANew = await loginWith(baseUrl, EMAIL_A, PASS_A_RESET);
    check("Login dengan password baru berhasil", loginANew.ok);

    // 9. Ubah password sendiri: sesi lain dicabut, sesi saat ini tetap
    const loginA3 = await loginWith(baseUrl, EMAIL_A, PASS_A_RESET);
    const loginA4 = await loginWith(baseUrl, EMAIL_A, PASS_A_RESET);

    const rWrongCurrent = await request(baseUrl, "/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: loginA3.cookie },
      body: JSON.stringify({ currentPassword: "salah-total", newPassword: PASS_A2 }),
    });
    check("Password lama salah 401", rWrongCurrent.status === 401, `dapat ${rWrongCurrent.status}`);

    const rSameAsOld = await request(baseUrl, "/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: loginA3.cookie },
      body: JSON.stringify({ currentPassword: PASS_A_RESET, newPassword: PASS_A_RESET }),
    });
    check("Password baru sama dengan lama ditolak 400", rSameAsOld.status === 400, `dapat ${rSameAsOld.status}`);

    const rSameAsEmail = await request(baseUrl, "/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: loginA3.cookie },
      body: JSON.stringify({ currentPassword: PASS_A_RESET, newPassword: EMAIL_A }),
    });
    check("Password baru sama dengan email ditolak 400", rSameAsEmail.status === 400, `dapat ${rSameAsEmail.status}`);

    const rChange = await request(baseUrl, "/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: loginA3.cookie },
      body: JSON.stringify({ currentPassword: PASS_A_RESET, newPassword: PASS_A2 }),
    });
    check("Change password 200", rChange.status === 200, `dapat ${rChange.status}`);

    const rMeCurrent = await request(baseUrl, "/auth/me", { headers: { Cookie: loginA3.cookie } });
    check("Sesi saat ini tetap aktif 200", rMeCurrent.status === 200);

    const rMeOther = await request(baseUrl, "/auth/me", { headers: { Cookie: loginA4.cookie } });
    check("Sesi lain dicabut 401", rMeOther.status === 401, `dapat ${rMeOther.status}`);

    const rLoginAfterChangeOld = await loginWith(baseUrl, EMAIL_A, PASS_A_RESET);
    check("Login password lama ditolak setelah ganti", !rLoginAfterChangeOld.ok);
    const rLoginAfterChangeNew = await loginWith(baseUrl, EMAIL_A, PASS_A2);
    check("Login password baru berhasil", rLoginAfterChangeNew.ok);

    console.log("=== Seluruh Pemeriksaan P11 LULUS ===");
  } finally {
    // Semua akun [SMOKE] (domain @smoke.test) dihapus; sesi ikut lewat onDelete: Cascade
    await db.adminUser.deleteMany({ where: { email: { endsWith: "@smoke.test" } } });
    await close();
  }
}

async function loginWith(baseUrl: string, email: string, password: string) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  return { ok: res.status === 200, status: res.status, cookie };
}

run().catch((err) => {
  console.error("Smoke test P11 gagal:", err);
  process.exit(1);
});
