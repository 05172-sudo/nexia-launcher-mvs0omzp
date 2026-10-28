# Nexia Launcher (Electron)

Windows x64 · login Microsoft · Vanilla / Fabric / Forge เลือกเวอร์ชันได้ · Instance ดึงจากเว็บแอดมิน (ต้องอยู่ใน whitelist)

## 1) Microsoft login (ต้องทำก่อน ไม่งั้น login ไม่ผ่าน)
1. portal.azure.com → App registrations → New registration
   - ชื่อห้ามมีคำว่า Minecraft / Mojang / Microsoft / Xbox
   - Supported account types: **Personal Microsoft accounts only**
2. Authentication → เปิด **Allow public client flows = Yes** → Save
3. คัดลอก **Application (client) ID** ใส่ `config.json` → `msClientId`
4. ส่ง Client ID ให้ Mojang อนุมัติที่ https://aka.ms/mce-reviewappid (รอตรวจประมาณสัปดาห์)
   - ระหว่างรอ จะขึ้นข้อความ "Invalid app registration" ตอน login ซึ่งเป็นเรื่องปกติ

## 2) Backend (whitelist + instance)
ดู `nexia-backend/README.md` แล้วนำ URL ของ Worker มาใส่ `config.json` → `apiBase`

## 3) Build ผ่านเว็บ html-to-exe-github.html (ตัวที่แพตช์แล้ว)
- zip โฟลเดอร์นี้ (ต้องมี `package.json` กับ `main.js` ที่ root) → วางในเว็บ → ใส่ GitHub token → ได้ `nexia-launcher.exe` (portable)
- เว็บเวอร์ชันแพตช์จะตรวจเจอ package.json + main.js แล้วใช้ของเราตรง ๆ ไม่ห่อ main.js ใหม่

## 4) ออกอัปเดต
1. เพิ่ม `version` ใน `package.json` → build ใหม่
2. อัปโหลด exe ไว้ที่ลิงก์ https **สาธารณะ** (repo ที่เว็บสร้างเป็น private ผู้เล่นโหลดจากลิงก์ release ไม่ได้)
3. หน้าแอดมิน → "อัปเดตตัว Launcher" ใส่เวอร์ชัน + URL → ผู้เล่นจะเห็นปุ่ม "อัปเดตเลย" ตอนเปิด launcher

## ข้อจำกัดตอนนี้
- Windows x64 เท่านั้น · Forge เฉพาะ MC 1.13+ · ยังไม่มี NeoForge
- ยังไม่ได้ compile/ทดสอบบน Windows จริง (ทดสอบ logic ส่วน rules/merge/path และ backend ด้วย mock แล้ว)
