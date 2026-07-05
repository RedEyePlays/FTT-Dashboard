
# Windows Easy Deployment Guide: FTT-Dash

This guide is designed for Windows users to quickly set up and deploy the **FlipThatTech Dashboard**.

## 1. Prerequisites
*   **Node.js**: Install from [nodejs.org](https://nodejs.org/) (Download the **LTS** version).
*   **DreamHost FTP**: Have your FileZilla or WebFTP ready.

---

## 2. Create Project Folder
1.  Create a new folder on your Desktop named `ftt-dash`.
2.  Open that folder.
3.  Click the address bar at the top (where it says `> Desktop > ftt-dash`), type `cmd`, and hit **Enter**.
4.  A black window appears. Paste the following command and hit **Enter**:
    ```cmd
    npm create vite@latest . -- --template react-ts
    ```
    *(If asked to proceed, type `y` and hit Enter).*
5.  Paste this command to install the required tools:
    ```cmd
    npm install lucide-react recharts @google/genai react-markdown crypto-js tailwindcss postcss autoprefixer
    ```
6.  Initialize the styling engine:
    ```cmd
    npx tailwindcss init -p
    ```

---

## 3. Add App Files
You must now replace the default files with the code provided.

1.  **Delete** the existing `src` folder inside `ftt-dash`.
2.  **Create** a new `src` folder.
3.  Inside `src`, create two new folders: `components` and `services`.
4.  **Create and paste** the code for all the provided files (`App.tsx`, `types.ts`, `components/...`, etc.) into their respective folders.
    *   *Tip: You can use Notepad or VS Code to create these files.*
5.  **Important**: Open the `tailwind.config.js` file in the main folder and paste the provided configuration code (from previous instructions).
6.  **Important**: Open `index.html` and ensure the Gemini API fix script is in the `<head>` section.

---

## 4. Build the App
Instead of a batch file, run these standard commands in your Command Prompt (make sure you are still inside the `ftt-dash` folder):

1.  **Build the project** by running:
    ```cmd
    npm run build
    ```
2.  Wait for it to finish. You should see a message saying `dist/index.html ... gzip: ...`.
3.  This creates a folder named **`dist`** inside your project folder. This folder contains your final, production-ready website.

---

## 5. Upload to DreamHost
1.  Connect to your DreamHost server using FileZilla.
2.  Navigate to your domain folder (e.g., `yourwebsite.com`).
3.  Open the **`dist`** folder on your computer.
4.  Select **ALL** files inside `dist` (you should see an `assets` folder and an `index.html`).
5.  **Drag and drop** them into the DreamHost folder.
6.  Visit your website!

## 6. First Login
The app authenticates with **Firebase Authentication (email + password)** — there
is no local PIN.

*   On first visit, create an account (or sign in) on the auth screen.
*   The first account to sign in becomes the **Owner** of a new workspace.
    Additional staff join via an Owner-issued invite (Users tab). See
    `MIGRATION.md` for the roles/workspace model and required Firebase setup
    (deploy `firestore.rules`, enable the Email/Password provider).
