# MSPC Attendance System - Product Requirements Document (PRD)

The **MSPC Attendance System** is a secure, responsive, full-stack web application designed for internal organization management to streamline attendance tracking, scheduling, and RSVP coordination for support groups and meetings (such as Parkinson's and Multiple Sclerosis support networks). 

The platform connects three core user classes (Admins, Leaders, and Members/Attendees) through direct web dashboards and secure, passwordless magic links, integrating real-time database updates and robust CSV import processing.

---

## 1. Executive Summary & Core Objectives

### Purpose
Manage and automate attendance logging, RSVPs, carer-attendee grouping, and event generation for local support chapters. This replaces manual or paper-based systems, ensuring that coordinators can track attendance accurately and securely.

### High-Level Value
- **Zero-Password Portals**: Secure access for leaders and members using tokenized magic links.
- **Unified Carer-Member Mapping**: Supports side-by-side (two-up) matching of members and their corresponding support people/carers for attendance tracking.
- **Automated Event Generation**: Generates 35 days of event occurrences based on group scheduling rules.
- **Infoodle Compatibility**: Provides bulk importing of CSV datasets from third-party systems like Infoodle.

---

## 2. User Roles & Access Hierarchy

The application enforces Role-Based Access Control (RBAC) across three primary roles:

### 2.1 Admin & Staff Users
- **Access**: Securely authenticated via Firebase Google Sign-In (UID whitelisted in the `admins` Firestore collection).
- **Primary Interface**: Comprehensive multi-tab management dashboard.
- **Capabilities**:
  - View overall calendar schedules and roster submission statuses.
  - Import bulk datasets (People, Events, Groups, Group Members) via custom-mapped Infoodle-compatible CSV formats.
  - Conduct full system backups (JSON export) and restorations (Exact Mirror or Merge Sync).
  - Inspect audit logs capturing data creation, updates, and deletions.
  - Define and update Groups, Group Types, and Schedule patterns.
  - Generate prospective events in bulk.

### 2.2 Group Leaders
- **Access**: Passwordless tokenized URLs (`/leader/:accessCode`).
- **Primary Interface**: Dedicated single-screen Leader Portal optimized for tablets and mobile devices.
- **Capabilities**:
  - Filter and search group lists.
  - Submit attendance rosters for current or past events.
  - Log real-time check-ins for attendees and their associated support carers.
  - Capture session-specific member notes (e.g., transport needs, health updates).
  - View side-by-side member/carer pairings or a merged adaptive layout on smaller viewports.

### 2.3 Members / Attendees
- **Access**: Unique tokenized URLs (`/portal/:accessCode`).
- **Primary Interface**: Minimalist, high-accessibility RSVP dashboard.
- **Capabilities**:
  - View personal upcoming schedule of registered group events.
  - Log attendance intentions (RSVP: **Booked** or **Cancelled**).
  - Leave direct coordination notes for event organizers (e.g., "Need wheelchair taxi support").

---

## 3. Data Model & Firestore Collections

The backend architecture runs on Google Cloud Firestore. The collections, schemas, and relationships are modeled as follows:

### 3.1 `people` (Person)
Represents any individual in the database.
- `id` (string, document ID): Unique system UUID.
- `infoodleId` (string): External ID mapping from third-party CSV (Infoodle).
- `firstName` (string) & `lastName` (string): Standard display name.
- `email` (string): User contact email.
- `accessCode` (string): Cryptographically secure magic token for URLs.
- `type` (enum): `member`, `support`, `admin`, `contact`, `external`, `staff`.
- `condition` (string, optional): `MS` (Multiple Sclerosis) or `PD` (Parkinson's Disease) for classification filters.
- `supportPersonId` (string, optional): Foreign Key pointing to another Person (their support worker/carer).
- `supportPersonName` (string, optional): Plaintext name reference for fallback matching.
- `createdAt` (timestamp): Record creation date.

### 3.2 `events` (Event)
Scheduled sessions representing a physical or virtual support meeting.
- `id` (string, document ID): Unique UUID.
- `infoodleId` (string): External session reference.
- `groupId` (string): Foreign Key pointing to `groups`.
- `title` (string): Descriptive name of the meeting (e.g., "Parkinson's - Rangiora Support Group").
- `date` (string): ISO format date string (`YYYY-MM-DD`).
- `time` (string): Human-readable start time (e.g., `10:00 am`).
- `duration` (number): Event length in minutes (e.g., `60`).
- `status` (enum): `active`, `cancelled`, `submitted` (roster logged), `exported` (pushed to external systems).
- `notes` (string, optional): Coordinator notes or details.
- `createdAt` (timestamp): Record creation date.

### 3.3 `rosters` (Roster Entry)
Junction table linking people to events, tracking individual RSVP and check-in statuses.
- `eventId` (string): Target event ID.
- `personId` (string): Target person ID.
- `role` (enum): `member`, `leader`, `speaker`, `staff`, `support`.
- `rsvpStatus` (enum): `potential`, `booked`, `cancelled`.
- `attendanceStatus` (enum): `present`, `absent`, `unknown`, `no-show`.
- `note` (string, optional): Notes specific to this attendance instance.
- `createdAt` (timestamp) & `updatedAt` (timestamp): Tracks logging latency.

### 3.4 `groups` (Group / Organisation)
Local regional chapters (e.g., "North Canterbury Support Group").
- `id` (string, document ID): Unique reference.
- `groupTypeId` (string): References category from `groupTypes`.
- `name` (string): Distinct chapter name.
- `dateRule` (string) & `timeRule` (string): Pattern logic used for automated calendar recurrence.
- `who` (string, optional): Target demographic notes.
- `locationName` (string) & `locationLink` (string, optional): Venue layout coordinates and maps link.

### 3.5 `groupMembers` (Group Membership Junction)
Connects people to regional groups with dedicated operational roles.
- `groupId` (string): Target group reference.
- `personId` (string): Target person reference.
- `role` (enum): `member`, `leader`, `speaker`, `staff`, `support`.

### 3.6 `groupTypes`
Higher-level categories for sorting organizational branches.
- `id` (string, document ID): Key definition.
- `shortValue` (string): e.g., `MS` or `PD`.
- `longValue` (string): e.g., `Multiple Sclerosis Support` or `Parkinson's Support`.

---

## 4. Key Operational Workflows & Business Logic

### 4.1 Grid-Level Attendance Checkbox Logic
The attendance checks follow an interactive state matrix that adapts according to the RSVP status of the attendee:

1. **If RSVP is "Booked"**:
   - **Present (Ticked)**: Green fill. Click cycles state to *No Show*.
   - **No Show (Unticked)**: Blue fill/border. Click cycles state back to *Present*.
2. **If RSVP is "Cancelled"**:
   - **Absent / Cancelled (Unticked)**: Red fill. Click cycles state to *Present*.
   - **Present / Walk-in (Ticked)**: Orange fill. Click cycles state back to *Cancelled*.
3. **If RSVP is "Potential" (No pre-arranged status)**:
   - **Present (Ticked)**: Dark slate fill. Click cycles state to *Unknown*.
   - **Unknown / Absent (Unticked)**: White transparent square. Click cycles state to *Present*.

### 4.2 Two-Up (Dual Column) Roster Layout
- **Desktop (Larger Screens)**: Roster table displays a dual-column layout mapping **Member** on the left with **Support/Carer** on the right side-by-side in a single row. This enables swift parallel tracking of couples or individuals traveling with assistants.
- **Mobile / Adaptive Viewports**: On smaller screens, the tables join dynamically into a single continuous vertical list with one sticky header to prevent layout breaking or truncation issues.

### 4.3 Automated Recurrence Generator
The Admin Engine evaluates the `groups` scheduling rule parameters (e.g., "First Monday of the month") and dynamically triggers bulk insertions of future `events` for a rolling window of **35 days**, checking for duplication conflicts with existing events prior to write execution.

### 4.4 Dynamic Auto-Reclassification
To avoid manual overhead, whenever a CSV imports or changes are made to a Person:
- If a person possesses a recorded diagnosis/condition matching `MS` or `PD`, they are automatically reclassified with the `member` type.
- If they are linked as a support provider for another member, they are re-evaluated to the `support` type (unless they carry a diagnostic condition).
- If they hold structural group roles of `leader` or `speaker`, authorization permissions are modified dynamically.

---

## 5. Technology Stack & Deployment Architecture

- **Frontend Core**: React 19 (Hooks, Functional Components, Context) compiled with **Vite 6**.
- **State & Animations**: Dynamic motion visual cues powered by `@tailwindcss/vite` and `motion` layout animations.
- **Icons & Display**: `lucide-react` font icons.
- **Scheduling Viewport**: Integrated `react-big-calendar` localized with `moment`.
- **Backend Routing**: Express Node.js engine proxying server-side requests.
- **Environment & Key Protection**: Critical API keys (Firebase credentials, etc.) are kept server-side to hide credentials from client build inspectors.
- **Build bundling**: Optimized ESBuild server compiler outputting standardized CJS (`dist/server.cjs`) to guarantee smooth Cloud Run cold starts.
