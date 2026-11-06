# RepliQ

RepliQ est un assistant WhatsApp pour entreprises connecté à la **WhatsApp Cloud API** de Meta. Il reçoit les messages entrants, stocke les discussions dans **Supabase (PostgreSQL)**, génère des réponses automatiques intelligentes, et fournit une **Boîte de réception d'administration (Inbox)** permettant à un opérateur humain d'inspecter les échanges et de prendre la main à tout moment.

L'architecture est minimaliste, sans framework lourd : fonctions serverless Node.js sur **Vercel** (`/api`), utilitaires dans `/lib`, et pages statiques légères (`index.html`, `formulaire.html`, `admin.html`).

---

## Architecture & Fonctionnement

```
                                      ┌────────────────────────────────┐
                                      │       Client (WhatsApp)        │
                                      └──────────────┬─────────────────┘
                                                     │  Messages WhatsApp
                                                     ▼
                                      ┌────────────────────────────────┐
                                      │   Meta WhatsApp Cloud API      │
                                      └───────┬────────────────▲───────┘
                                              │                │
                             POST /api/webhook│                │ POST /messages
                                              ▼                │
                                      ┌────────────────┐       │
                                      │ api/webhook.js │       │
                                      └───────┬────────┘       │
                                              │                │
            ┌─────────────────────────────────┼────────────────┴────────────────┐
            │                                 │                                 │
            ▼                                 ▼                                 │
┌─────────────────────────┐       ┌─────────────────────────┐                   │
│   Supabase (Postgres)   │       │ Claude / Groq (lib/ai)  │                   │
│ - conversations         │       │ Mémoire des 10 derniers ├───────────────────┘
│ - messages              │       │ messages de l'historique│ (si takeover = false)
│ - Realtime broadcast    │       └─────────────────────────┘
└───────────▲─────────────┘
            │
            │ Realtime (Postgres changes) / REST
            │
┌───────────┴─────────────┐
│  Inbox Admin (/admin)   │
│ - admin.html            │
│ - admin.js / admin.css  ├──────► POST /api/admin/send (sender = 'human')
│ - Mode Humain/Bot       │        Enforce la fenêtre de 24h Meta
└─────────────────────────┘
```

1. **Réception** : Meta appelle `POST /api/webhook`. Le message est upserté dans `conversations` et enregistré dans `messages` (déduplication par `wa_message_id`).
2. **Prise en main (Takeover)** : Si `human_takeover = true`, le message est sauvegardé mais le bot reste silencieux.
3. **Mémoire & Réponse Bot** : Si `human_takeover = false`, les 10 derniers messages de la discussion sont chargés et transmis comme historique (`history`) au moteur d'IA. La réponse est envoyée sur WhatsApp et enregistrée avec `sender = 'bot'`.
4. **Accusés de réception** : Les statuts Meta (`sent`, `delivered`, `read`, `failed`) mettent à jour le statut du message dans Supabase en direct.
5. **Inbox Admin** : Accessible via `/admin.html`, elle permet à l'administrateur de suivre les messages en temps réel (Supabase Realtime ou polling 5s) et de répondre manuellement (`sender = 'human'`) sous respect strict de la fenêtre de 24 heures Meta.

---

## Structure du projet

```
RepliQ/
├── api/
│   ├── webhook.js            # Webhook Meta (GET vérification, POST réception & statuts)
│   └── admin/
│       ├── login.js          # Authentification administrateur (cookie/JWT signé)
│       ├── conversations.js  # Liste des conversations (triées par activité + non-lus)
│       ├── messages.js       # Historique complet d'une conversation
│       ├── send.js           # Envoi humain via WhatsApp Cloud API (contrôle fenêtre 24h)
│       ├── takeover.js       # Bascule prise en main (human_takeover: true/false)
│       └── read.js           # Réinitialisation du compteur de messages non-lus
├── lib/
│   ├── supabase.js           # Client Supabase Admin & requêtes PostgreSQL (RLS service role)
│   ├── admin-auth.js         # Sécurisation des endpoints admin (HMAC-SHA256)
│   ├── whatsapp.js           # Appels API Meta Graph (envoi texte/templates, markAsRead)
│   ├── window.js             # Gestion & vérification de la fenêtre client Meta 24h
│   ├── ai.js                 # Génération de réponse IA (Claude / Groq) et garde-fous
│   └── templates.js          # Helpers pour les modèles WhatsApp
├── supabase/
│   └── schema.sql            # Migration SQL (tables, index, RLS, publication Realtime)
├── admin.html                # Interface de l'inbox d'administration
├── admin.js                  # Logique SPA (Realtime, bascule takeover, envoi, responsive)
├── admin.css                 # Style épuré type WhatsApp Web (mode sombre / mobile-first)
├── index.html                # Page d'accueil vitrine
├── formulaire.html           # Formulaire de contact / devis
├── package.json
└── .env.example              # Modèle de variables d'environnement
```

---

## 1. Configuration de la base de données (Supabase)

1. Créez un projet gratuit sur [Supabase](https://supabase.com).
2. Rendez-vous dans votre projet Supabase > **SQL Editor**.
3. Ouvrez le fichier [`supabase/schema.sql`](file:///home/hamra/Desktop/Projects/RepliQ/supabase/schema.sql), copiez son contenu dans l'éditeur SQL et cliquez sur **Run**.
4. La migration crée :
   - La table `conversations` (`id`, `wa_contact_phone`, `contact_name`, `human_takeover`, `last_message_at`, `last_inbound_at`, `unread_count`, `created_at`).
   - La table `messages` (`id`, `conversation_id`, `wa_message_id`, `direction`, `sender`, `type`, `body`, `status`, `error`, `created_at`).
   - Les index de performance sur `(conversation_id, created_at)` et `wa_message_id`.
   - Les politiques de sécurité RLS (Row Level Security) : seules les fonctions côté serveur utilisant la `SUPABASE_SERVICE_ROLE_KEY` écrivent dans la base. Les clés secrètes ne sont jamais exposées au navigateur.
   - L'activation de **Supabase Realtime** sur les tables `conversations` et `messages`.
5. Récupérez vos identifiants dans Supabase > **Project Settings > API** :
   - `Project URL` → `SUPABASE_URL`
   - `service_role` (secret) → `SUPABASE_SERVICE_ROLE_KEY`
   - `anon` (public) → `SUPABASE_ANON_KEY`

---

## 2. Variables d'environnement

Copiez `.env.example` en `.env` pour le développement local :

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `WHATSAPP_TOKEN` | Jeton d'accès Meta (Meta App Dashboard > WhatsApp > API Setup) |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant du numéro de téléphone WhatsApp Business |
| `VERIFY_TOKEN` | Chaîne de vérification arbitraire définie dans la configuration du Webhook Meta |
| `ANTHROPIC_API_KEY` | Clé d'API Claude (console.anthropic.com) ou `GROQ_API_KEY` |
| `SUPABASE_URL` | URL de votre instance Supabase (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service_role secrète de Supabase (serveur uniquement) |
| `SUPABASE_ANON_KEY` | Clé publique anonyme Supabase (utilisée pour Supabase Realtime) |
| `ADMIN_PASSWORD` | Mot de passe d'accès à l'Inbox d'administration (`/admin.html`) |
| `ADMIN_JWT_SECRET` | Chaîne secrète pour signer les jetons de session de l'admin |

---

## 3. Déploiement sur Vercel

1. Installez le CLI Vercel si besoin :
   ```bash
   npm install -g vercel
   ```
2. Liez et déployez votre projet :
   ```bash
   vercel
   ```
3. Dans votre tableau de bord **Vercel > Project > Settings > Environment Variables**, ajoutez l'ensemble des variables d'environnement listées ci-dessus.
4. Redéployez en production :
   ```bash
   vercel --prod
   ```

---

## 4. Configuration du Webhook WhatsApp (Meta)

1. Dans le **Meta App Dashboard** > **WhatsApp** > **Configuration** :
   - **Callback URL** : `https://<votre-domaine-vercel>.vercel.app/api/webhook`
   - **Verify token** : La valeur exacte configurée dans `VERIFY_TOKEN`.
2. Cliquez sur **Vérifier et enregistrer**.
3. Dans la liste **Champs du Webhook**, activez l'abonnement à `messages`.

---

## 5. Utilisation de l'Inbox Admin (`/admin.html`)

1. Rendez-vous sur `https://<votre-domaine-vercel>.vercel.app/admin.html`.
2. Entrez votre `ADMIN_PASSWORD`.
3. **Navigation & Consultation** :
   - La colonne de gauche affiche les conversations actives triées par heure du dernier message, avec pastille de messages non lus et statut ("🤖 Bot" ou "👤 Humain").
   - Cliquez sur une conversation pour afficher l'intégralité du fil de messages au centre.
4. **Prendre la main (Takeover)** :
   - Cliquez sur le bouton **« Prendre la main »** dans l'en-tête du chat.
   - Le statut passe en **👤 Prise en main active**. Dès cet instant, le bot ne répondra plus automatiquement à ce client.
5. **Répondre manuellement** :
   - Tapez votre message dans le champ texte et appuyez sur Entrée (ou le bouton Envoyer).
   - Le message est envoyé via l'API WhatsApp Cloud et stocké avec `sender = 'human'`.
   - **Fenêtre des 24h Meta** : Si le dernier message entrant du client date de plus de 24h, l'envoi libre est automatiquement désactivé avec un avertissement visible (l'envoi de template WhatsApp est requis pour réengager le client).
6. **Rendre la main au bot** :
   - Cliquez à nouveau sur le bouton pour repasser en mode **🤖 Bot actif**. Le bot traitera à nouveau les prochains messages de ce client avec son historique en mémoire.

---

## Tests automatisés

Pour lancer la suite de tests automatisés :

```bash
npm test
```
