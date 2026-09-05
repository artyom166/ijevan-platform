const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, "database.sqlite"));
db.pragma("foreign_keys = ON");

const uploadDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '✨'
);

CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    image TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY(category_id)
        REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(profile_id, user_id),

    FOREIGN KEY(profile_id)
        REFERENCES profiles(id)
        ON DELETE CASCADE,

    FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,

    UNIQUE(profile_id, user_id),

    FOREIGN KEY(profile_id)
        REFERENCES profiles(id)
        ON DELETE CASCADE,

    FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(profile_id)
        REFERENCES profiles(id)
        ON DELETE CASCADE,

    FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

/* =========================
   DEFAULT CATEGORIES
========================= */

const defaultCategories = [
    ["Վարսավիր / Barber", "💈"],
    ["Վարսահարդար", "💇‍♀️"],
    ["Ավտոսպասարկում", "🚗"],
    ["Լուսանկարիչ", "📸"],
    ["Շինարար", "🧱"],
    ["Էլեկտրիկ", "⚡"],
    ["Խանութ", "🛍️"],
    ["Սնունդ", "🍔"],
    ["Տաքսի / Վարորդ", "🚕"],
    ["Հագուստ", "👕"],
    ["Համակարգիչներ", "💻"],
    ["Այլ ծառայություն", "✨"]
];

const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories(name, icon)
    VALUES (?, ?)
`);

for (const category of defaultCategories) {
    insertCategory.run(category[0], category[1]);
}

/* =========================
   DEFAULT ADMIN
========================= */

const adminEmail = "admin@ijevan.local";
const adminPassword = "Admin123!";

const existingAdmin = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(adminEmail);

if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);

    db.prepare(`
        INSERT INTO users(name, email, password, is_admin)
        VALUES (?, ?, ?, 1)
    `).run(
        "Ijevan Admin",
        adminEmail,
        passwordHash
    );
}

/* =========================
   EXPRESS
========================= */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(
    path.join(__dirname, "public")
));

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "ijevan-platform-secret-change-this",

        resave: false,
        saveUninitialized: false,

        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

/* =========================
   UPLOAD
========================= */

const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {

        const ext =
            path.extname(file.originalname).toLowerCase();

        const filename =
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .substring(2) +
            ext;

        cb(null, filename);
    }
});

const upload = multer({

    storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const allowed = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        ];

        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Միայն JPG, PNG կամ WEBP նկարներ են թույլատրվում։"));
        }
    }
});

/* =========================
   MIDDLEWARE
========================= */

function requireAuth(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    next();
}

function requireAdmin(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    if (!req.session.user.is_admin) {
        return res.status(403).send("Մուտքը թույլատրված չէ։");
    }

    next();
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

    const q = (req.query.q || "").trim();
    const category = req.query.category || "";

    let sql = `
        SELECT
            p.*,
            u.name AS owner,
            c.name AS category,
            c.icon AS icon,
            COALESCE(AVG(r.rating), 0) AS rating,
            COUNT(r.id) AS review_count

        FROM profiles p

        JOIN users u
            ON u.id = p.user_id

        JOIN categories c
            ON c.id = p.category_id

        LEFT JOIN reviews r
            ON r.profile_id = p.id

        WHERE 1 = 1
    `;

    const params = [];

    if (q) {

        sql += `
            AND (
                p.title LIKE ?
                OR p.description LIKE ?
                OR u.name LIKE ?
                OR c.name LIKE ?
            )
        `;

        const search = `%${q}%`;

        params.push(
            search,
            search,
            search,
            search
        );
    }

    if (category) {

        sql += `
            AND p.category_id = ?
        `;

        params.push(category);
    }

    sql += `
        GROUP BY p.id
        ORDER BY p.id DESC
    `;

    const profiles =
        db.prepare(sql).all(...params);

    const categories =
        db.prepare(`
            SELECT *
            FROM categories
            ORDER BY name
        `).all();

    res.render("index", {
        profiles,
        categories,
        q,
        category
    });
});

/* =========================
   REGISTER
========================= */

app.get("/register", (req, res) => {

    res.render("register", {
        error: null
    });
});

app.post("/register", (req, res) => {

    const name =
        (req.body.name || "").trim();

    const email =
        (req.body.email || "")
            .trim()
            .toLowerCase();

    const password =
        req.body.password || "";

    if (!name || !email || !password) {

        return res.render("register", {
            error: "Լրացրու բոլոր դաշտերը։"
        });
    }

    if (password.length < 6) {

        return res.render("register", {
            error:
                "Գաղտնաբառը պետք է լինի առնվազն 6 նիշ։"
        });
    }

    try {

        const hash =
            bcrypt.hashSync(password, 10);

        const result =
            db.prepare(`
                INSERT INTO users(
                    name,
                    email,
                    password
                )
                VALUES (?, ?, ?)
            `).run(
                name,
                email,
                hash
            );

        req.session.user = {
            id: result.lastInsertRowid,
            name,
            email,
            is_admin: 0
        };

        res.redirect("/");

    } catch (error) {

        res.render("register", {
            error:
                "Այս email-ը արդեն օգտագործված է։"
        });
    }
});

/* =========================
   LOGIN
========================= */

app.get("/login", (req, res) => {

    res.render("login", {
        error: null
    });
});

app.post("/login", (req, res) => {

    const email =
        (req.body.email || "")
            .trim()
            .toLowerCase();

    const password =
        req.body.password || "";

    const user =
        db.prepare(`
            SELECT *
            FROM users
            WHERE email = ?
        `).get(email);

    if (
        !user ||
        !bcrypt.compareSync(
            password,
            user.password
        )
    ) {

        return res.render("login", {
            error:
                "Email-ը կամ գաղտնաբառը սխալ է։"
        });
    }

    req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin
    };

    res.redirect("/");
});

/* =========================
   LOGOUT
========================= */

app.post("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/");
    });
});

/* =========================
   ADD PROFILE
========================= */

app.get("/add-profile", requireAuth, (req, res) => {

    const categories =
        db.prepare(`
            SELECT *
            FROM categories
            ORDER BY name
        `).all();

    res.render("add-profile", {
        categories,
        error: null
    });
});

app.post(
    "/add-profile",
    requireAuth,
    upload.single("image"),
    (req, res) => {

        const {
            category_id,
            title,
            description,
            phone,
            address
        } = req.body;

        const categories =
            db.prepare(`
                SELECT *
                FROM categories
                ORDER BY name
            `).all();

        if (!category_id || !title) {

            return res.render(
                "add-profile",
                {
                    categories,
                    error:
                        "Վերնագիրը և կատեգորիան պարտադիր են։"
                }
            );
        }

        const image =
            req.file
                ? "/uploads/" + req.file.filename
                : "";

        db.prepare(`
            INSERT INTO profiles(
                user_id,
                category_id,
                title,
                description,
                phone,
                address,
                image
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.user.id,
            category_id,
            title.trim(),
            description || "",
            phone || "",
            address || "Իջևան",
            image
        );

        res.redirect("/");
    }
);


/* =========================
   MY SERVICES
========================= */

app.get(
    "/my-services",
    requireAuth,
    (req, res) => {

        const profiles = db.prepare(`
            SELECT
                p.*,
                c.name AS category,
                c.icon AS icon,
                COALESCE(AVG(r.rating), 0) AS rating,
                COUNT(r.id) AS review_count
            FROM profiles p

            JOIN categories c
                ON c.id = p.category_id

            LEFT JOIN reviews r
                ON r.profile_id = p.id

            WHERE p.user_id = ?

            GROUP BY p.id

            ORDER BY p.id DESC
        `).all(req.session.user.id);

        res.render("my-services", {
            profiles
        });
    }
);


/* =========================
   EDIT SERVICE
========================= */

app.get(
    "/profile/:id/edit",
    requireAuth,
    (req, res) => {

        const profile = db.prepare(`
            SELECT *
            FROM profiles
            WHERE id = ?
            AND user_id = ?
        `).get(
            req.params.id,
            req.session.user.id
        );

        if (!profile) {
            return res.status(403).send(
                "Դուք իրավունք չունեք փոփոխելու այս ծառայությունը։"
            );
        }

        const categories = db.prepare(`
            SELECT *
            FROM categories
            ORDER BY name
        `).all();

        res.render("edit-profile", {
            profile,
            categories,
            error: null
        });
    }
);


/* =========================
   UPDATE SERVICE
========================= */

app.post(
    "/profile/:id/edit",
    requireAuth,
    upload.single("image"),
    (req, res) => {

        const profile = db.prepare(`
            SELECT *
            FROM profiles
            WHERE id = ?
            AND user_id = ?
        `).get(
            req.params.id,
            req.session.user.id
        );

        if (!profile) {
            return res.status(403).send(
                "Դուք իրավունք չունեք փոփոխելու այս ծառայությունը։"
            );
        }

        const {
            category_id,
            title,
            description,
            phone,
            address
        } = req.body;

        const categories = db.prepare(`
            SELECT *
            FROM categories
            ORDER BY name
        `).all();

        if (!category_id || !title || !title.trim()) {

            return res.render("edit-profile", {
                profile,
                categories,
                error: "Վերնագիրը և կատեգորիան պարտադիր են։"
            });
        }

        let image = profile.image;

        if (req.file) {

            image = "/uploads/" + req.file.filename;

            // Հին նկարը ջնջում ենք
            if (profile.image) {

                const oldImage =
                    path.join(
                        __dirname,
                        "public",
                        profile.image
                    );

                if (fs.existsSync(oldImage)) {
                    fs.unlinkSync(oldImage);
                }
            }
        }

        db.prepare(`
            UPDATE profiles

            SET
                category_id = ?,
                title = ?,
                description = ?,
                phone = ?,
                address = ?,
                image = ?

            WHERE id = ?
            AND user_id = ?
        `).run(
            category_id,
            title.trim(),
            description || "",
            phone || "",
            address || "Իջևան",
            image,
            req.params.id,
            req.session.user.id
        );

        res.redirect(
            "/profile/" + req.params.id
        );
    }
);


/* =========================
   DELETE SERVICE
========================= */

app.post(
    "/profile/:id/delete",
    requireAuth,
    (req, res) => {

        const profile = db.prepare(`
            SELECT *
            FROM profiles
            WHERE id = ?
            AND user_id = ?
        `).get(
            req.params.id,
            req.session.user.id
        );

        if (!profile) {
            return res.status(403).send(
                "Դուք իրավունք չունեք ջնջելու այս ծառայությունը։"
            );
        }

        // Ջնջում ենք նկարը
        if (profile.image) {

            const imagePath =
                path.join(
                    __dirname,
                    "public",
                    profile.image
                );

            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        db.prepare(`
            DELETE FROM profiles
            WHERE id = ?
            AND user_id = ?
        `).run(
            req.params.id,
            req.session.user.id
        );

        res.redirect("/my-services");
    }
);



/* =========================
   PROFILE
========================= */

app.get("/profile/:id", (req, res) => {

    const profile =
        db.prepare(`
            SELECT
                p.*,
                u.name AS owner,
                c.name AS category,
                c.icon AS icon,
                COALESCE(
                    AVG(r.rating),
                    0
                ) AS rating,
                COUNT(r.id) AS review_count

            FROM profiles p

            JOIN users u
                ON u.id = p.user_id

            JOIN categories c
                ON c.id = p.category_id

            LEFT JOIN reviews r
                ON r.profile_id = p.id

            WHERE p.id = ?

            GROUP BY p.id
        `).get(req.params.id);

    if (!profile) {
        return res
            .status(404)
            .send("Պրոֆիլը չի գտնվել։");
    }

    const reviews =
        db.prepare(`
            SELECT
                r.*,
                u.name
            FROM reviews r
            JOIN users u
                ON u.id = r.user_id
            WHERE r.profile_id = ?
            ORDER BY r.id DESC
        `).all(req.params.id);

    let favorite = false;

    if (req.session.user) {

        favorite = !!db.prepare(`
            SELECT id
            FROM favorites
            WHERE profile_id = ?
            AND user_id = ?
        `).get(
            req.params.id,
            req.session.user.id
        );
    }

    res.render("profile", {
        p: profile,
        reviews,
        favorite
    });
});

/* =========================
   REVIEW
========================= */

app.post(
    "/profile/:id/review",
    requireAuth,
    (req, res) => {

        let rating =
            Number(req.body.rating);

        if (rating < 1) rating = 1;
        if (rating > 5) rating = 5;

        const comment =
            (req.body.comment || "").trim();

        db.prepare(`
            INSERT INTO reviews(
                profile_id,
                user_id,
                rating,
                comment
            )
            VALUES (?, ?, ?, ?)

            ON CONFLICT(
                profile_id,
                user_id
            )

            DO UPDATE SET
                rating = excluded.rating,
                comment = excluded.comment
        `).run(
            req.params.id,
            req.session.user.id,
            rating,
            comment
        );

        res.redirect(
            "/profile/" + req.params.id
        );
    }
);

/* =========================
   FAVORITE
========================= */

app.post(
    "/profile/:id/favorite",
    requireAuth,
    (req, res) => {

        const existing =
            db.prepare(`
                SELECT id
                FROM favorites
                WHERE profile_id = ?
                AND user_id = ?
            `).get(
                req.params.id,
                req.session.user.id
            );

        if (existing) {

            db.prepare(`
                DELETE FROM favorites
                WHERE profile_id = ?
                AND user_id = ?
            `).run(
                req.params.id,
                req.session.user.id
            );

        } else {

            db.prepare(`
                INSERT INTO favorites(
                    profile_id,
                    user_id
                )
                VALUES (?, ?)
            `).run(
                req.params.id,
                req.session.user.id
            );
        }

        res.redirect(
            "/profile/" + req.params.id
        );
    }
);

/* =========================
   FAVORITES PAGE
========================= */

app.get(
    "/favorites",
    requireAuth,
    (req, res) => {

        const profiles =
            db.prepare(`
                SELECT
                    p.*,
                    u.name AS owner,
                    c.name AS category,
                    c.icon AS icon,
                    COALESCE(
                        AVG(r.rating),
                        0
                    ) AS rating,
                    COUNT(r.id) AS review_count

                FROM favorites f

                JOIN profiles p
                    ON p.id = f.profile_id

                JOIN users u
                    ON u.id = p.user_id

                JOIN categories c
                    ON c.id = p.category_id

                LEFT JOIN reviews r
                    ON r.profile_id = p.id

                WHERE f.user_id = ?

                GROUP BY p.id

                ORDER BY f.id DESC
            `).all(req.session.user.id);

        res.render(
            "favorites",
            { profiles }
        );
    }
);

/* =========================
   REPORT
========================= */

app.post(
    "/profile/:id/report",
    requireAuth,
    (req, res) => {

        const reason =
            (req.body.reason || "Այլ").trim();

        db.prepare(`
            INSERT INTO reports(
                profile_id,
                user_id,
                reason
            )
            VALUES (?, ?, ?)
        `).run(
            req.params.id,
            req.session.user.id,
            reason
        );

        res.redirect(
            "/profile/" + req.params.id
        );
    }
);

/* =========================
   ADMIN DASHBOARD
========================= */

app.get(
    "/admin",
    requireAdmin,
    (req, res) => {

        const stats = {

            users:
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM users
                `).get().count,

            profiles:
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM profiles
                `).get().count,

            reviews:
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM reviews
                `).get().count,

            reports:
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM reports
                    WHERE status = 'pending'
                `).get().count
        };

        res.render(
            "admin/dashboard",
            { stats }
        );
    }
);

/* =========================
   ADMIN PROFILES
========================= */

app.get(
    "/admin/profiles",
    requireAdmin,
    (req, res) => {

        const profiles =
            db.prepare(`
                SELECT
                    p.*,
                    u.name AS owner,
                    c.name AS category

                FROM profiles p

                JOIN users u
                    ON u.id = p.user_id

                JOIN categories c
                    ON c.id = p.category_id

                ORDER BY p.id DESC
            `).all();

        res.render(
            "admin/profiles",
            { profiles }
        );
    }
);

app.post(
    "/admin/profiles/:id/delete",
    requireAdmin,
    (req, res) => {

        db.prepare(`
            DELETE FROM profiles
            WHERE id = ?
        `).run(req.params.id);

        res.redirect(
            "/admin/profiles"
        );
    }
);

/* =========================
   ADMIN REPORTS
========================= */

app.get(
    "/admin/reports",
    requireAdmin,
    (req, res) => {

        const reports =
            db.prepare(`
                SELECT
                    r.*,
                    p.title,
                    u.name AS reporter

                FROM reports r

                JOIN profiles p
                    ON p.id = r.profile_id

                JOIN users u
                    ON u.id = r.user_id

                ORDER BY r.id DESC
            `).all();

        res.render(
            "admin/reports",
            { reports }
        );
    }
);

app.post(
    "/admin/reports/:id/status",
    requireAdmin,
    (req, res) => {

        const status =
            ["pending", "reviewed", "resolved"]
                .includes(req.body.status)
                ? req.body.status
                : "pending";

        db.prepare(`
            UPDATE reports
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            req.params.id
        );

        res.redirect(
            "/admin/reports"
        );
    }
);

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).send(
        "Սերվերի սխալ։ " +
        (err.message || "")
    );
});

/* =========================
   START
========================= */

app.listen(PORT, () => {

    console.log("");
    console.log("=================================");
    console.log(" Ijevan Platform is running");
    console.log(" http://localhost:" + PORT);
    console.log("=================================");
    console.log("");
    console.log("Admin:");
    console.log("Email: " + adminEmail);
    console.log("Password: " + adminPassword);
    console.log("");
});