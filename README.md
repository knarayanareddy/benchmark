# Ground Truth Circle — ACAPS × Hackathon for Good #8
### Upleveled & Improved Production Version

> A trusted, moderated expert network where humanitarian practitioners, local civil society, and researchers challenge, enrich, and forecast ACAPS risk analyses on their own terms.

---

## 🌟 Key Improvements in this Version

### 1. In-Page Persona Picking Across All Views
- **My Space (`/me`)**: When signed out, provides an interactive `PersonaSelector` with 1-click access to featured demo personas, user-created personas, and a search filter over all 29+ personas. When signed in, includes a dedicated `MySpaceToolbar` allowing instant switching or profile creation without leaving the page.
- **Roundtable (`/risks/[id]`)**: Displays a dedicated `RoundtableHeader` showing active persona identity, and highlights which personas have already answered the risk's question to unlock the debate. If locked, users can switch to an unlocked persona with a single click.
- **Pulse (`/pulse`) & Questions (`/q/[id]`)**: Replaced dead-end text links with rich inline persona cards and quick profile creation access.

### 2. Context-Preserving Persona Switching
- Resolved the issue where switching personas in `PersonaSwitcher` forcefully kicked users to `/pulse`.
- Switching personas now reloads the **current page in place** (preserving your place in the Roundtable, My Space, or Question cards). Only transitions to/from Moderator console trigger appropriate path re-routing.

### 3. Guaranteed Profile Persistence
- Fixed a React server-component caching issue where newly inserted experts in PostgreSQL were not resolved by `currentExpert()`, causing newly joined experts to evaluate as `null`.
- Added a direct database query fallback in `src/lib/session.ts` and `src/app/api/session/route.ts` so newly created profiles are recognized and activated immediately.
- User-created profiles are prominently grouped at the very top under **🌟 My Created Personas** in the header switcher and persona selector cards.

### 4. Full Profile Editing in My Space
- Extended `ProfileForm` and `src/app/api/profile/route.ts` to allow editing **Real Name**, **Organisation**, **Role Type**, **Countries Covered**, and **Themes**, in addition to anonymity levels and weekly caps.
- Saves directly to PostgreSQL with instant page sync.

### 5. Streamlined Join & Invite Flow
- Added 1-click clickable demo invite chips (`CHAD-7QX2`, `SAHEL-4KD9`, `HORN-2MP8`, `LEVANT-9TR3`, `PEER-DEMO1`) and an **Instant Demo Access** button in `JoinFlow.tsx`.
- Supports `returnTo` URL parameter so joining from Roundtable or My Space redirects you straight back to the view you came from.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18+ (tested on Node v26)
- **PostgreSQL**: v14+ running locally or in Docker

### 2. Environment Setup
Create a `.env` file (or copy from `.env.example`):
```bash
cp .env.example .env
```
Ensure your `DATABASE_URL` is set:
```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Initialize Database Schema & Seed Data
Push the Drizzle schema to your PostgreSQL database:
```bash
npx drizzle-kit push
```
*(On first application start, the app automatically seeds 139 real ACAPS risks, triggers, and calibrated expert archetypes).*

### 5. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🗺️ Key Routes

- **Home**: [`/`](http://localhost:3000/) — Overview, core pillars, and persona introduction.
- **Pulse**: [`/pulse`](http://localhost:3000/pulse) — Personalized weekly asks and radar based on domain expertise.
- **Risks Radar**: [`/risks`](http://localhost:3000/risks) — 139 ACAPS risks with search, filtering, and status tracking.
- **Roundtable**: [`/risks/R1043`](http://localhost:3000/risks/R1043) — Structured debate on live risks (e.g., Chad–Sudan border escalation).
- **My Space**: [`/me`](http://localhost:3000/me) — Calibration mirror, privacy proofs, and profile editing.
- **Moderator Console**: [`/moderator`](http://localhost:3000/moderator) — Dispatch lab, dissent loop desk, and integrity monitors.
- **Honour Roll**: [`/honour`](http://localhost:3000/honour) — High-track-record experts who opted into public attribution.
- **Join / Profile**: [`/join`](http://localhost:3000/join) — 4-step onboarding flow.

---

## 👥 Demo Personas

| Name | Role | Country | Anonymity Level | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Fatimé Abakar** *(Saffron Otter)* | Local NGO | Chad | **Alias** | Has active question waiting on Chad–Sudan border risk (R1043). |
| **Dr. Claire Nguema** *(Tidal Civet)* | Researcher | Chad / Sahel | **On the Stage** *(Named)* | Dissenter with active dissent loop and Honour roll standing. |
| **Idriss Mahamat** *(Coral Marten)* | Early Warning | Chad | **Sealed** | Fully anonymous early-warning practitioner. |
| **Samuel Eze** *(Slate Otter)* | Researcher | Nigeria | **Known to ACAPS** | Conflict analyst with conflict-of-interest flag. |
| **ACAPS Moderator** | Moderator | Global | **Named** | Full access to dispatching, synthesis, and integrity radar. |

---

## 🛠️ Tech Stack
- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI & Styling**: React 19, Tailwind CSS v4
- **Database**: PostgreSQL with Drizzle ORM & `pg` driver
- **Typography & Theme**: Apple System Fonts, ACAPS Serif, warm paper tone (`#f6f3ee`)
