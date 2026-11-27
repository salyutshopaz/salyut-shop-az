
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL .env faylında yoxdur!");
}

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET .env faylında yoxdur!");
}

if (!process.env.ADMIN_EMAIL) {
    console.warn("XƏBƏRDARLIQ: ADMIN_EMAIL .env faylında qeyd edilməyib!");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadDirectory = path.join(__dirname, "private_uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

// ==================================================
// MIDDLEWARE
// ==================================================
app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.set("Cache-Control", "no-cache");
    res.send(
        "User-agent: *\n" +
        "Allow: /\n\n" +
        "Sitemap: https://salyut-shop-az.onrender.com/sitemap.xml\n"
    );
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    name: "salyut.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ==================================================
// ÜMUMİ FUNKSİYALAR
// ==================================================

function removeFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlink(filePath, error => {
            if (error) console.error("Fayl silinmədi:", error);
        });
    }
}

function checkImageFile(filePath) {
    const buffer = fs.readFileSync(filePath);

    const isJpeg =
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff;

    const isPng =
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        );

    const isWebp =
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";

    if (isJpeg) return ".jpg";
    if (isPng) return ".png";
    if (isWebp) return ".webp";

    return null;
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: "Əvvəlcə hesabınıza daxil olun."
        });
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: "Əvvəlcə giriş edin."
        });
    }

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

    if (
        !adminEmail ||
        req.session.user.email.toLowerCase() !== adminEmail
    ) {
        return res.status(403).json({
            success: false,
            message: "Bu bölməyə giriş icazəniz yoxdur."
        });
    }

    next();
}

// ==================================================
// QƏBZ YÜKLƏMƏ SİSTEMİ
// ==================================================

const receiptStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDirectory);
    },

    filename: (req, file, cb) => {
        const extension = file.mimetype === "image/jpeg"
            ? ".jpg"
            : file.mimetype === "image/png"
                ? ".png"
                : ".webp";

        cb(null, crypto.randomUUID() + extension);
    }
});

const upload = multer({
    storage: receiptStorage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
            return cb(new Error("Yalnız JPG, PNG və WEBP şəkilləri qəbul edilir."));
        }

        cb(null, true);
    }
});

// ==================================================
// MƏHSUL ŞƏKİLLƏRİ — CLOUDINARY
// ==================================================

const productUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
            return cb(new Error("Yalnız JPG, PNG və WEBP şəkilləri qəbul edilir."));
        }

        cb(null, true);
    }
});

function checkImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) return false;

    const isJpeg =
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff;

    const isPng =
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        );

    const isWebp =
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";

    return isJpeg || isPng || isWebp;
}

function cloudinaryIsConfigured() {
    return Boolean(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

function uploadProductImage(buffer) {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            {
                folder: "salyut-shop-az/products",
                resource_type: "image"
            },
            (error, result) => {
                if (error) return reject(error);
                if (!result?.secure_url) {
                    return reject(new Error("Cloudinary şəkil URL-i qaytarmadı."));
                }
                resolve(result.secure_url);
            }
        ).end(buffer);
    });
}

function getCloudinaryPublicId(imageUrl) {
    if (typeof imageUrl !== "string" || !imageUrl.includes("res.cloudinary.com")) {
        return null;
    }

    try {
        const pathname = new URL(imageUrl).pathname;
        const match = pathname.match(/\/upload\/(?:v\d+\/)?(.+)\.[^/.]+$/);
        return match ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

async function deleteCloudinaryImage(imageUrl) {
    const publicId = getCloudinaryPublicId(imageUrl);
    if (!publicId || !cloudinaryIsConfigured()) return;

    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    } catch (error) {
        console.error("Cloudinary köhnə şəkli silə bilmədi:", error);
    }
}

// ==================================================
// CƏDVƏLLƏR
// ==================================================

async function createTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
        ADD COLUMN IF NOT EXISTS city VARCHAR(100),
        ADD COLUMN IF NOT EXISTS settlement VARCHAR(100),
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
        ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS deposits (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            amount NUMERIC(12,2) NOT NULL CHECK (amount >= 1),
            receipt_file TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TIMESTAMP,
            reviewed_by VARCHAR(255)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS deposits_user_id_idx
        ON deposits(user_id)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS deposits_status_idx
        ON deposits(status)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_balance_history (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            admin_email VARCHAR(255) NOT NULL,
            action VARCHAR(20) NOT NULL
                CHECK (action IN ('add', 'subtract')),
            amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
            balance_before NUMERIC(12,2) NOT NULL,
            balance_after NUMERIC(12,2) NOT NULL,
            note VARCHAR(300),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS admin_balance_history_user_idx
        ON admin_balance_history(user_id, created_at DESC)
    `);

    // MƏHSULLAR

    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            category VARCHAR(100),
            price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
            old_price NUMERIC(12,2),
            description TEXT,
            image TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS products_created_at_idx
        ON products(created_at DESC)
    `);

    // SİFARİŞLƏR

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            customer_name VARCHAR(100) NOT NULL,
            phone VARCHAR(30) NOT NULL,
            city VARCHAR(100) NOT NULL,
            settlement VARCHAR(100),
            postal_code VARCHAR(20),
            address TEXT NOT NULL,
            total NUMERIC(12,2) NOT NULL CHECK (total > 0),
            status VARCHAR(30) NOT NULL DEFAULT 'pending'
                CHECK (status IN (
                    'pending',
                    'processing',
                    'shipped',
                    'completed',
                    'cancelled'
                )),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL
                REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER
                REFERENCES products(id) ON DELETE SET NULL,
            product_title VARCHAR(200) NOT NULL,
            product_price NUMERIC(12,2) NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            subtotal NUMERIC(12,2) NOT NULL
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS orders_user_id_idx
        ON orders(user_id, created_at DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS order_items_order_id_idx
        ON order_items(order_id)
    `);

    console.log("İstifadəçi cədvəli hazırdır.");
    console.log("Profil sütunları hazırdır.");
    console.log("Balans və depozit sistemi hazırdır.");
    console.log("Admin balans tarixçəsi hazırdır.");
    console.log("Məhsul sistemi hazırdır.");
    console.log("Sifariş sistemi hazırdır.");
}

// ==================================================
// QEYDİYYAT
// ==================================================

app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Məlumatları düzgün daxil et!"
            });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (!cleanName || !cleanEmail || !password) {
            return res.status(400).json({
                success: false,
                message: "Bütün xanaları doldur!"
            });
        }

        if (cleanName.length > 100 || cleanEmail.length > 255) {
            return res.status(400).json({
                success: false,
                message: "Daxil edilən məlumat çox uzundur."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({
                success: false,
                message: "E-poçt ünvanı düzgün deyil."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Şifrə ən azı 8 simvol olmalıdır!"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, name, email`,
            [cleanName, cleanEmail, passwordHash]
        );

        const user = result.rows[0];

        req.session.regenerate(error => {
            if (error) {
                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "Sessiya yaradıla bilmədi."
                });
            }

            req.session.cookie.maxAge = 24 * 60 * 60 * 1000;
            req.session.user = user;

            req.session.save(saveError => {
                if (saveError) {
                    console.error(saveError);

                    return res.status(500).json({
                        success: false,
                        message: "Giriş yadda saxlanmadı."
                    });
                }

                return res.status(201).json({
                    success: true,
                    message: "Qeydiyyat uğurludur!",
                    user
                });
            });
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "Bu e-poçt artıq qeydiyyatdan keçib."
            });
        }

        console.error("Qeydiyyat xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Server xətası baş verdi."
        });
    }
});

// ==================================================
// GİRİŞ
// ==================================================

app.post("/api/login", async (req, res) => {
    try {
        const { email, password, remember } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "E-poçt və şifrəni daxil et!"
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (!cleanEmail || !password) {
            return res.status(400).json({
                success: false,
                message: "E-poçt və şifrəni daxil et!"
            });
        }

        const result = await pool.query(
            `SELECT id, name, email, password_hash
             FROM users
             WHERE email = $1`,
            [cleanEmail]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                message: "E-poçt və ya şifrə yanlışdır."
            });
        }

        const account = result.rows[0];

        const passwordCorrect = await bcrypt.compare(
            password,
            account.password_hash
        );

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "E-poçt və ya şifrə yanlışdır."
            });
        }

        const user = {
            id: account.id,
            name: account.name,
            email: account.email
        };

        req.session.regenerate(error => {
            if (error) {
                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "Sessiya yaradıla bilmədi."
                });
            }

            req.session.cookie.maxAge = remember === true
                ? 30 * 24 * 60 * 60 * 1000
                : 24 * 60 * 60 * 1000;

            req.session.user = user;

            req.session.save(saveError => {
                if (saveError) {
                    console.error(saveError);

                    return res.status(500).json({
                        success: false,
                        message: "Giriş yadda saxlanmadı."
                    });
                }

                return res.json({
                    success: true,
                    message: "Uğurla giriş edildi!",
                    user
                });
            });
        });

    } catch (error) {
        console.error("Giriş xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Server xətası baş verdi."
        });
    }
});

// ==================================================
// PROFİL
// ==================================================

app.get("/api/profile", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, city,
                    settlement, address, postal_code
             FROM users
             WHERE id = $1`,
            [req.session.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı."
            });
        }

        return res.json({
            success: true,
            user: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Profil məlumatlarını yükləmək mümkün olmadı."
        });
    }
});

app.put("/api/profile", requireLogin, async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            city,
            settlement,
            address,
            postal_code
        } = req.body;

        const fields = {
            name,
            email,
            phone,
            city,
            settlement,
            address,
            postal_code
        };

        for (const value of Object.values(fields)) {
            if (typeof value !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "Bütün məlumatları düzgün daxil edin."
                });
            }
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = phone.trim();
        const cleanCity = city.trim();
        const cleanSettlement = settlement.trim();
        const cleanAddress = address.trim();
        const cleanPostalCode = postal_code.trim();

        if (!cleanName || !cleanEmail) {
            return res.status(400).json({
                success: false,
                message: "Ad və e-poçt boş qala bilməz."
            });
        }

        if (cleanName.length > 100 || cleanEmail.length > 255) {
            return res.status(400).json({
                success: false,
                message: "Ad və ya e-poçt çox uzundur."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({
                success: false,
                message: "E-poçt düzgün deyil."
            });
        }

        if (
            cleanPhone.length > 30 ||
            cleanCity.length > 100 ||
            cleanSettlement.length > 100 ||
            cleanPostalCode.length > 20 ||
            cleanAddress.length > 1000
        ) {
            return res.status(400).json({
                success: false,
                message: "Məlumatlardan biri çox uzundur."
            });
        }

        const result = await pool.query(
            `UPDATE users
             SET name = $1,
                 email = $2,
                 phone = $3,
                 city = $4,
                 settlement = $5,
                 address = $6,
                 postal_code = $7
             WHERE id = $8
             RETURNING id, name, email, phone, city,
                       settlement, address, postal_code`,
            [
                cleanName,
                cleanEmail,
                cleanPhone,
                cleanCity,
                cleanSettlement,
                cleanAddress,
                cleanPostalCode,
                req.session.user.id
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı."
            });
        }

        const updatedUser = result.rows[0];

        req.session.user = {
            id: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email
        };

        req.session.save(error => {
            if (error) {
                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "Sessiyanı yeniləmək mümkün olmadı."
                });
            }

            return res.json({
                success: true,
                message: "Məlumatlar yadda saxlanıldı!",
                user: updatedUser
            });
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "Bu e-poçt başqa hesabda istifadə olunur."
            });
        }

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Məlumatları yadda saxlamaq mümkün olmadı."
        });
    }
});

// ==================================================
// BALANS
// ==================================================

app.get("/api/balance", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT balance
             FROM users
             WHERE id = $1`,
            [req.session.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı."
            });
        }

        return res.json({
            success: true,
            balance: result.rows[0].balance
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Balansı yükləmək mümkün olmadı."
        });
    }
});

// ==================================================
// DEPOZİT SORĞUSU
// ==================================================

app.post(
    "/api/deposits",
    requireLogin,
    (req, res, next) => {
        upload.single("receipt")(req, res, error => {
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "Qəbz maksimum 5 MB ola bilər."
                        : error.message
                });
            }

            next();
        });
    },
    async (req, res) => {
        let safePath = null;

        try {
            const amountText = req.body.amount;

            if (
                typeof amountText !== "string" ||
                !/^\d{1,8}(\.\d{1,2})?$/.test(amountText)
            ) {
                if (req.file) removeFile(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Depozit məbləği düzgün deyil."
                });
            }

            const amount = Number(amountText);

            if (!Number.isFinite(amount) || amount < 1 || amount > 10000) {
                if (req.file) removeFile(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Depozit 1 AZN ilə 10 000 AZN arasında olmalıdır."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "Ödəniş qəbzini yükləyin."
                });
            }

            const extension = checkImageFile(req.file.path);

            if (!extension) {
                removeFile(req.file.path);

                return res.status(400).json({
                    success: false,
                    message: "Yüklənən fayl düzgün şəkil deyil."
                });
            }

            const safeFilename = crypto.randomUUID() + extension;
            safePath = path.join(uploadDirectory, safeFilename);

            fs.renameSync(req.file.path, safePath);

            const result = await pool.query(
                `INSERT INTO deposits (user_id, amount, receipt_file)
                 VALUES ($1, $2, $3)
                 RETURNING id, amount, status, created_at`,
                [
                    req.session.user.id,
                    amount.toFixed(2),
                    safeFilename
                ]
            );

            return res.status(201).json({
                success: true,
                message: "Depozit sorğunuz göndərildi. Təsdiq gözlənilir.",
                deposit: result.rows[0]
            });

        } catch (error) {
            console.error("Depozit xətası:", error);

            if (req.file) removeFile(req.file.path);
            if (safePath) removeFile(safePath);

            return res.status(500).json({
                success: false,
                message: "Depozit sorğusu göndərilə bilmədi."
            });
        }
    }
);

// MÜŞTƏRİNİN DEPOZİT TARİXÇƏSİ

app.get("/api/deposits", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, amount, status, created_at, reviewed_at
             FROM deposits
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [req.session.user.id]
        );

        return res.json({
            success: true,
            deposits: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Depozit tarixçəsini yükləmək mümkün olmadı."
        });
    }
});

// ==================================================
// ADMIN: DEPOZİTLƏR
// ==================================================

app.get("/api/admin/deposits", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                d.id,
                d.user_id,
                d.amount,
                d.status,
                d.receipt_file,
                d.created_at,
                d.reviewed_at,
                d.reviewed_by,
                u.name,
                u.email
             FROM deposits d
             JOIN users u ON u.id = d.user_id
             ORDER BY
                CASE WHEN d.status = 'pending' THEN 0 ELSE 1 END,
                d.created_at DESC
             LIMIT 500`
        );

        return res.json({
            success: true,
            deposits: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Depozitlər yüklənə bilmədi."
        });
    }
});

// ADMIN: QƏBZƏ BAX

app.get("/api/admin/deposits/:id/receipt", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: "Yanlış depozit nömrəsi."
            });
        }

        const result = await pool.query(
            `SELECT receipt_file
             FROM deposits
             WHERE id = $1`,
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Qəbz tapılmadı."
            });
        }

        const filename = path.basename(result.rows[0].receipt_file);
        const filePath = path.join(uploadDirectory, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: "Qəbz faylı tapılmadı."
            });
        }

        res.setHeader("Cache-Control", "no-store");

        return res.sendFile(filePath);

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Qəbzi açmaq mümkün olmadı."
        });
    }
});

// ADMIN: DEPOZİTİ TƏSDİQ ET VƏ YA RƏDD ET

app.patch("/api/admin/deposits/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: "Depozit nömrəsi düzgün deyil."
        });
    }

    if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Status düzgün deyil."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const depositResult = await client.query(
            `SELECT id, user_id, amount, status
             FROM deposits
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );

        if (!depositResult.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Depozit tapılmadı."
            });
        }

        const deposit = depositResult.rows[0];

        if (deposit.status !== "pending") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "Bu depozit artıq nəzərdən keçirilib."
            });
        }

        if (status === "approved") {
            const userResult = await client.query(
                `SELECT balance
                 FROM users
                 WHERE id = $1
                 FOR UPDATE`,
                [deposit.user_id]
            );

            if (!userResult.rows.length) {
                throw new Error("Depozit istifadəçisi tapılmadı.");
            }

            const before = userResult.rows[0].balance;

            const updateResult = await client.query(
                `UPDATE users
                 SET balance = balance + $1::numeric
                 WHERE id = $2
                 RETURNING balance`,
                [deposit.amount, deposit.user_id]
            );

            await client.query(
                `INSERT INTO admin_balance_history
                 (user_id, admin_email, action, amount,
                  balance_before, balance_after, note)
                 VALUES ($1, $2, 'add', $3, $4, $5, $6)`,
                [
                    deposit.user_id,
                    req.session.user.email,
                    deposit.amount,
                    before,
                    updateResult.rows[0].balance,
                    `Depozit #${id} təsdiqləndi`
                ]
            );
        }

        await client.query(
            `UPDATE deposits
             SET status = $1,
                 reviewed_at = CURRENT_TIMESTAMP,
                 reviewed_by = $2
             WHERE id = $3`,
            [status, req.session.user.email, id]
        );

        await client.query("COMMIT");

        return res.json({
            success: true,
            message: status === "approved"
                ? "Depozit təsdiqləndi və balans artırıldı!"
                : "Depozit rədd edildi."
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Admin depozit xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Əməliyyatı tamamlamaq mümkün olmadı."
        });

    } finally {
        client.release();
    }
});

// ==================================================
// ADMIN: STATİSTİKA
// ==================================================

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COALESCE(SUM(balance), 0) FROM users) AS total_balance,
                (SELECT COUNT(*) FROM deposits WHERE status = 'pending') AS pending_deposits,
                (SELECT COUNT(*) FROM deposits WHERE status = 'approved') AS approved_deposits
        `);

        return res.json({
            success: true,
            stats: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Statistikanı yükləmək mümkün olmadı."
        });
    }
});

// ==================================================
// ADMIN: MÜŞTƏRİLƏR
// ==================================================

app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
        const search = typeof req.query.search === "string"
            ? req.query.search.trim().slice(0, 100)
            : "";

        const result = await pool.query(
            `SELECT id, name, email, phone, city, balance, created_at
             FROM users
             WHERE $1 = ''
                OR name ILIKE '%' || $1 || '%'
                OR email ILIKE '%' || $1 || '%'
             ORDER BY created_at DESC
             LIMIT 500`,
            [search]
        );

        return res.json({
            success: true,
            users: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Müştəriləri yükləmək mümkün olmadı."
        });
    }
});

// ADMIN: BALANS TARİXÇƏSİ

app.get("/api/admin/users/:id/history", requireAdmin, async (req, res) => {
    try {
        const userId = Number(req.params.id);

        if (!Number.isInteger(userId) || userId < 1) {
            return res.status(400).json({
                success: false,
                message: "Müştəri nömrəsi düzgün deyil."
            });
        }

        const result = await pool.query(
            `SELECT id, admin_email, action, amount,
                    balance_before, balance_after, note, created_at
             FROM admin_balance_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [userId]
        );

        return res.json({
            success: true,
            history: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Balans tarixçəsini yükləmək mümkün olmadı."
        });
    }
});

// ADMIN: BALANS ARTIR VƏ YA AZALT

app.patch("/api/admin/users/:id/balance", requireAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    const { action, amount, note } = req.body;

    if (!Number.isInteger(userId) || userId < 1) {
        return res.status(400).json({
            success: false,
            message: "Müştəri nömrəsi düzgün deyil."
        });
    }

    if (!["add", "subtract"].includes(action)) {
        return res.status(400).json({
            success: false,
            message: "Əməliyyat növü düzgün deyil."
        });
    }

    const amountText = String(amount ?? "");

    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountText)) {
        return res.status(400).json({
            success: false,
            message: "Məbləğ düzgün daxil edilməyib."
        });
    }

    const amountNumber = Number(amountText);

    if (
        !Number.isFinite(amountNumber) ||
        amountNumber <= 0 ||
        amountNumber > 1000000
    ) {
        return res.status(400).json({
            success: false,
            message: "Məbləğ düzgün deyil."
        });
    }

    if (note !== undefined && (typeof note !== "string" || note.length > 300)) {
        return res.status(400).json({
            success: false,
            message: "Qeyd maksimum 300 simvol ola bilər."
        });
    }

    const cleanNote = typeof note === "string" ? note.trim() : "";
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(
            `SELECT id, name, email, balance
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [userId]
        );

        if (!userResult.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Müştəri tapılmadı."
            });
        }

        const user = userResult.rows[0];
        const beforeCents = Math.round(Number(user.balance) * 100);
        const amountCents = Math.round(amountNumber * 100);

        if (action === "subtract" && beforeCents < amountCents) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Müştərinin balansında kifayət qədər vəsait yoxdur."
            });
        }

        const updateResult = await client.query(
            action === "add"
                ? `UPDATE users
                   SET balance = balance + $1::numeric
                   WHERE id = $2
                   RETURNING balance`
                : `UPDATE users
                   SET balance = balance - $1::numeric
                   WHERE id = $2
                   RETURNING balance`,
            [amountNumber.toFixed(2), userId]
        );

        const balanceAfter = updateResult.rows[0].balance;

        await client.query(
            `INSERT INTO admin_balance_history
             (user_id, admin_email, action, amount,
              balance_before, balance_after, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                userId,
                req.session.user.email,
                action,
                amountNumber.toFixed(2),
                user.balance,
                balanceAfter,
                cleanNote || null
            ]
        );

        await client.query("COMMIT");

        return res.json({
            success: true,
            message: action === "add"
                ? "Müştərinin balansı artırıldı!"
                : "Müştərinin balansı azaldıldı!",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                balance: balanceAfter
            }
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Balans əməliyyatını tamamlamaq mümkün olmadı."
        });

    } finally {
        client.release();
    }
});

// ==================================================
// MƏHSUL SİSTEMİ
// ==================================================

app.get("/api/products", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, category, price, old_price,
                    description, image, created_at
             FROM products
             ORDER BY created_at DESC`
        );

        return res.json({
            success: true,
            products: result.rows
        });

    } catch (error) {
        console.error("Məhsulların yüklənmə xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Məhsulları yükləmək mümkün olmadı."
        });
    }
});

// ==================================================
// ADMIN: MƏHSUL İDARƏETMƏSİ
// ==================================================

app.get("/api/admin/products", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, category, price, old_price,
                    description, image, created_at, updated_at
             FROM products
             ORDER BY created_at DESC`
        );

        return res.json({
            success: true,
            products: result.rows
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Məhsulları yükləmək mümkün olmadı."
        });
    }
});

function validateProduct(body) {
    const title = typeof body.title === "string"
        ? body.title.trim()
        : "";

    const category = typeof body.category === "string"
        ? body.category.trim()
        : "";

    const description = typeof body.description === "string"
        ? body.description.trim()
        : "";

    const priceText = String(body.price ?? "");
    const oldPriceText = String(body.old_price ?? "");

    if (!title || title.length > 200) {
        return {
            error: "Məhsul adı boş qala bilməz və 200 simvoldan çox olmamalıdır."
        };
    }

    if (category.length > 100 || description.length > 5000) {
        return {
            error: "Kateqoriya və ya təsvir çox uzundur."
        };
    }

    if (!/^\d{1,10}(\.\d{1,2})?$/.test(priceText)) {
        return {
            error: "Məhsul qiyməti düzgün deyil."
        };
    }

    const price = Number(priceText);

    if (!Number.isFinite(price) || price < 0 || price > 9999999999) {
        return {
            error: "Məhsul qiyməti düzgün deyil."
        };
    }

    let oldPrice = null;

    if (oldPriceText !== "" && oldPriceText !== "null") {
        if (!/^\d{1,10}(\.\d{1,2})?$/.test(oldPriceText)) {
            return {
                error: "Köhnə qiymət düzgün deyil."
            };
        }

        oldPrice = Number(oldPriceText);

        if (!Number.isFinite(oldPrice) || oldPrice < 0) {
            return {
                error: "Köhnə qiymət düzgün deyil."
            };
        }
    }

    return {
        value: {
            title,
            category: category || null,
            price: price.toFixed(2),
            old_price: oldPrice === null
                ? null
                : oldPrice.toFixed(2),
            description: description || null
        }
    };
}

// YENİ MƏHSUL ƏLAVƏ ET

app.post(
    "/api/admin/products",
    requireAdmin,
    (req, res, next) => {
        productUpload.single("image")(req, res, error => {
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "Şəkil maksimum 5 MB ola bilər."
                        : error.message
                });
            }
            next();
        });
    },
    async (req, res) => {
        let uploadedImageUrl = null;

        try {
            const validation = validateProduct(req.body);
            if (validation.error) {
                return res.status(400).json({ success: false, message: validation.error });
            }

            let image = null;
            if (req.file) {
                if (!checkImageBuffer(req.file.buffer)) {
                    return res.status(400).json({
                        success: false,
                        message: "Yüklənən şəkil faylı düzgün deyil."
                    });
                }

                if (!cloudinaryIsConfigured()) {
                    return res.status(500).json({
                        success: false,
                        message: "Cloudinary parametrləri serverdə qurulmayıb."
                    });
                }

                uploadedImageUrl = await uploadProductImage(req.file.buffer);
                image = uploadedImageUrl;
            }

            const product = validation.value;
            const result = await pool.query(
                `INSERT INTO products
                 (title, category, price, old_price, description, image)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [product.title, product.category, product.price, product.old_price, product.description, image]
            );

            return res.status(201).json({
                success: true,
                message: "Məhsul uğurla əlavə edildi!",
                product: result.rows[0]
            });
        } catch (error) {
            if (uploadedImageUrl) await deleteCloudinaryImage(uploadedImageUrl);
            console.error("Məhsul əlavə etmə xətası:", error);
            return res.status(500).json({
                success: false,
                message: "Məhsulu əlavə etmək mümkün olmadı."
            });
        }
    }
);

// MƏHSULU REDAKTƏ ET

app.put(
    "/api/admin/products/:id",
    requireAdmin,
    (req, res, next) => {
        productUpload.single("image")(req, res, error => {
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "Şəkil maksimum 5 MB ola bilər."
                        : error.message
                });
            }
            next();
        });
    },
    async (req, res) => {
        const id = Number(req.params.id);
        let uploadedImageUrl = null;

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: "Məhsul nömrəsi düzgün deyil."
            });
        }

        try {
            const validation = validateProduct(req.body);
            if (validation.error) {
                return res.status(400).json({ success: false, message: validation.error });
            }

            const existingResult = await pool.query(
                `SELECT image FROM products WHERE id = $1`,
                [id]
            );

            if (!existingResult.rows.length) {
                return res.status(404).json({ success: false, message: "Məhsul tapılmadı." });
            }

            const oldImage = existingResult.rows[0].image;
            let image = oldImage;

            if (req.file) {
                if (!checkImageBuffer(req.file.buffer)) {
                    return res.status(400).json({
                        success: false,
                        message: "Yüklənən şəkil faylı düzgün deyil."
                    });
                }

                if (!cloudinaryIsConfigured()) {
                    return res.status(500).json({
                        success: false,
                        message: "Cloudinary parametrləri serverdə qurulmayıb."
                    });
                }

                uploadedImageUrl = await uploadProductImage(req.file.buffer);
                image = uploadedImageUrl;
            }

            const product = validation.value;
            const result = await pool.query(
                `UPDATE products
                 SET title = $1, category = $2, price = $3, old_price = $4,
                     description = $5, image = $6, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $7
                 RETURNING *`,
                [product.title, product.category, product.price, product.old_price, product.description, image, id]
            );

            if (uploadedImageUrl && oldImage && oldImage !== uploadedImageUrl) {
                await deleteCloudinaryImage(oldImage);
            }

            return res.json({
                success: true,
                message: "Məhsul yeniləndi!",
                product: result.rows[0]
            });
        } catch (error) {
            if (uploadedImageUrl) await deleteCloudinaryImage(uploadedImageUrl);
            console.error("Məhsul redaktə xətası:", error);
            return res.status(500).json({
                success: false,
                message: "Məhsulu yeniləmək mümkün olmadı."
            });
        }
    }
);

// MƏHSULU SİL

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ success: false, message: "Məhsul nömrəsi düzgün deyil." });
        }

        const result = await pool.query(
            `DELETE FROM products WHERE id = $1 RETURNING image`,
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Məhsul tapılmadı." });
        }

        if (result.rows[0].image) {
            await deleteCloudinaryImage(result.rows[0].image);
        }

        return res.json({ success: true, message: "Məhsul silindi!" });
    } catch (error) {
        console.error("Məhsul silmə xətası:", error);
        return res.status(500).json({
            success: false,
            message: "Məhsulu silmək mümkün olmadı."
        });
    }
});

// ==================================================
// SİFARİŞ SİSTEMİ
// ==================================================

// YENİ SİFARİŞ YARAT

app.post("/api/orders", requireLogin, async (req, res) => {
    const {
        name,
        phone,
        city,
        settlement,
        postal_code,
        address,
        items
    } = req.body;

    if (
        typeof name !== "string" ||
        typeof phone !== "string" ||
        typeof city !== "string" ||
        typeof address !== "string" ||
        (settlement !== undefined && typeof settlement !== "string") ||
        (postal_code !== undefined && typeof postal_code !== "string")
    ) {
        return res.status(400).json({
            success: false,
            message: "Çatdırılma məlumatlarını düzgün daxil edin."
        });
    }

    const customerName = name.trim();
    const customerPhone = phone.trim();
    const customerCity = city.trim();
    const customerSettlement = (settlement || "").trim();
    const customerPostalCode = (postal_code || "").trim();
    const customerAddress = address.trim();

    if (
        !customerName ||
        !customerPhone ||
        !customerCity ||
        !customerAddress
    ) {
        return res.status(400).json({
            success: false,
            message: "Ad, telefon, şəhər və ünvan mütləq doldurulmalıdır."
        });
    }

    if (
        customerName.length > 100 ||
        customerPhone.length > 30 ||
        customerCity.length > 100 ||
        customerSettlement.length > 100 ||
        customerPostalCode.length > 20 ||
        customerAddress.length > 1000
    ) {
        return res.status(400).json({
            success: false,
            message: "Daxil edilən məlumatlardan biri çox uzundur."
        });
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({
            success: false,
            message: "Səbət boşdur və ya məhsul sayı düzgün deyil."
        });
    }

    const cleanItems = [];
    const usedIds = new Set();

    for (const item of items) {
        const productId = Number(item?.id);
        const quantity = Number(item?.quantity);

        if (
            !Number.isInteger(productId) ||
            productId < 1 ||
            !Number.isInteger(quantity) ||
            quantity < 1 ||
            quantity > 99
        ) {
            return res.status(400).json({
                success: false,
                message: "Səbətdə məhsul məlumatı düzgün deyil."
            });
        }

        if (usedIds.has(productId)) {
            return res.status(400).json({
                success: false,
                message: "Səbətdə təkrarlanan məhsul var."
            });
        }

        usedIds.add(productId);
        cleanItems.push({
            id: productId,
            quantity
        });
    }

    const productIds = cleanItems.map(item => item.id);

    const quantityById = new Map(
        cleanItems.map(item => [item.id, item.quantity])
    );

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // MÜŞTƏRİNİN BALANSINI KİLİDLƏ

        const userResult = await client.query(
            `SELECT id, balance
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [req.session.user.id]
        );

        if (!userResult.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı."
            });
        }

        // MƏHSULLARI BAZADAN GÖTÜR

        const productsResult = await client.query(
            `SELECT id, title, price
             FROM products
             WHERE id = ANY($1::int[])
             ORDER BY id
             FOR SHARE`,
            [productIds]
        );

        if (productsResult.rows.length !== productIds.length) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Səbətdəki məhsullardan biri artıq mövcud deyil."
            });
        }

        // QİYMƏTLƏRİ HESABLA

        let totalCents = 0;
        const orderItems = [];

        for (const product of productsResult.rows) {
            const quantity = quantityById.get(product.id);
            const priceCents = Math.round(Number(product.price) * 100);

            if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
                throw new Error("Məhsul qiyməti düzgün deyil.");
            }

            const subtotalCents = priceCents * quantity;

            if (!Number.isSafeInteger(subtotalCents)) {
                throw new Error("Sifariş məbləği çox böyükdür.");
            }

            totalCents += subtotalCents;

            orderItems.push({
                id: product.id,
                title: product.title,
                price: (priceCents / 100).toFixed(2),
                quantity,
                subtotal: (subtotalCents / 100).toFixed(2)
            });
        }

        if (
            !Number.isSafeInteger(totalCents) ||
            totalCents <= 0 ||
            totalCents > 100000000
        ) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Sifariş məbləği düzgün deyil."
            });
        }

        const total = (totalCents / 100).toFixed(2);

        const balanceCents = Math.round(
            Number(userResult.rows[0].balance) * 100
        );

        if (balanceCents < totalCents) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Balansınızda kifayət qədər vəsait yoxdur.",
                insufficientBalance: true,
                total,
                balance: userResult.rows[0].balance
            });
        }

        // BALANSDAN MƏBLƏĞİ ÇIX

        const balanceResult = await client.query(
            `UPDATE users
             SET balance = balance - $1::numeric
             WHERE id = $2
             RETURNING balance`,
            [total, req.session.user.id]
        );

        // SİFARİŞİ YARAT

        const orderResult = await client.query(
            `INSERT INTO orders (
                user_id,
                customer_name,
                phone,
                city,
                settlement,
                postal_code,
                address,
                total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, total, status, created_at`,
            [
                req.session.user.id,
                customerName,
                customerPhone,
                customerCity,
                customerSettlement || null,
                customerPostalCode || null,
                customerAddress,
                total
            ]
        );

        const order = orderResult.rows[0];

        // SİFARİŞ MƏHSULLARINI YADDA SAXLA

        for (const item of orderItems) {
            await client.query(
                `INSERT INTO order_items (
                    order_id,
                    product_id,
                    product_title,
                    product_price,
                    quantity,
                    subtotal
                )
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    order.id,
                    item.id,
                    item.title,
                    item.price,
                    item.quantity,
                    item.subtotal
                ]
            );
        }

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Sifarişiniz uğurla qəbul edildi!",
            order,
            items: orderItems,
            balance: balanceResult.rows[0].balance
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Sifariş rollback xətası:", rollbackError);
        }

        console.error("Sifariş yaratma xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Sifarişi yaratmaq mümkün olmadı."
        });

    } finally {
        client.release();
    }
});

// ==================================================
// MÜŞTƏRİNİN ÖZ SİFARİŞLƏRİ
// ==================================================

app.get("/api/orders", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                o.id,
                o.customer_name,
                o.phone,
                o.city,
                o.settlement,
                o.postal_code,
                o.address,
                o.total,
                o.status,
                o.created_at,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'product_id', oi.product_id,
                            'title', oi.product_title,
                            'price', oi.product_price,
                            'quantity', oi.quantity,
                            'subtotal', oi.subtotal
                        )
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'
                ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             WHERE o.user_id = $1
             GROUP BY o.id
             ORDER BY o.created_at DESC
             LIMIT 100`,
            [req.session.user.id]
        );

        return res.json({
            success: true,
            orders: result.rows
        });

    } catch (error) {
        console.error("Sifariş tarixçəsi xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Sifarişləri yükləmək mümkün olmadı."
        });
    }
});

// ==================================================
// ADMIN: BÜTÜN SİFARİŞLƏR
// ==================================================

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                o.id,
                o.user_id,
                o.customer_name,
                o.phone,
                o.city,
                o.settlement,
                o.postal_code,
                o.address,
                o.total,
                o.status,
                o.created_at,
                u.email,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'product_id', oi.product_id,
                            'title', oi.product_title,
                            'price', oi.product_price,
                            'quantity', oi.quantity,
                            'subtotal', oi.subtotal
                        )
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'
                ) AS items
            FROM orders o
            JOIN users u ON u.id = o.user_id
            LEFT JOIN order_items oi ON oi.order_id = o.id
            GROUP BY o.id, u.email
            ORDER BY
                CASE o.status
                    WHEN 'pending' THEN 1
                    WHEN 'processing' THEN 2
                    WHEN 'shipped' THEN 3
                    WHEN 'completed' THEN 4
                    WHEN 'cancelled' THEN 5
                END,
                o.created_at DESC
            LIMIT 500
        `);

        return res.json({
            success: true,
            orders: result.rows
        });

    } catch (error) {
        console.error("Admin sifarişləri xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Sifarişləri yükləmək mümkün olmadı."
        });
    }
});

// ==================================================
// ADMIN: SİFARİŞ STATUSUNU DƏYİŞ
// ==================================================

app.patch("/api/admin/orders/:id", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { status } = req.body;

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: "Sifariş nömrəsi düzgün deyil."
            });
        }

        const allowedStatuses = [
            "pending",
            "processing",
            "shipped",
            "completed",
            "cancelled"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Sifariş statusu düzgün deyil."
            });
        }

        const result = await pool.query(
            `UPDATE orders
             SET status = $1
             WHERE id = $2
             RETURNING id, status`,
            [status, id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Sifariş tapılmadı."
            });
        }

        return res.json({
            success: true,
            message: "Sifariş statusu yeniləndi!",
            order: result.rows[0]
        });

    } catch (error) {
        console.error("Sifariş statusu xətası:", error);

        return res.status(500).json({
            success: false,
            message: "Sifariş statusunu dəyişmək mümkün olmadı."
        });
    }
});

// ==================================================
// HAZIRKI İSTİFADƏÇİ
// ==================================================

app.get("/api/me", (req, res) => {
    if (!req.session.user) {
        return res.json({
            loggedIn: false
        });
    }

    return res.json({
        loggedIn: true,
        user: req.session.user
    });
});

// ==================================================
// ÇIXIŞ
// ==================================================

app.post("/api/logout", (req, res) => {
    req.session.destroy(error => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Çıxış zamanı xəta baş verdi."
            });
        }

        res.clearCookie("salyut.sid", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax"
        });

        return res.json({
            success: true,
            message: "Hesabdan çıxış edildi."
        });
    });
});

// ==================================================
// STATİK FAYLLAR
// ==================================================

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==================================================
// MULTER VƏ SERVER XƏTALARI
// ==================================================

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: error.code === "LIMIT_FILE_SIZE"
                ? "Şəkil maksimum 5 MB ola bilər."
                : "Fayl yüklənərkən xəta baş verdi."
        });
    }

    console.error(error);

    return res.status(500).json({
        success: false,
        message: "Server xətası baş verdi."
    });
});

// ==================================================
// SERVERİ BAŞLAT
// ==================================================

async function startServer() {
    try {
        await createTables();

        app.listen(PORT, () => {
            console.log(`SALYUT SHOP AZ: http://localhost:${PORT}`);
            console.log("Depozit sistemi aktivdir.");
            console.log("Admin müştəri və balans sistemi aktivdir.");
            console.log("Məhsul əlavə etmə, redaktə və silmə sistemi aktivdir.");
            console.log(cloudinaryIsConfigured() ? "Cloudinary şəkil sistemi aktivdir." : "XƏBƏRDARLIQ: Cloudinary parametrləri yoxdur.");
            console.log("Sifariş sistemi aktivdir.");
            console.log("Admin sifariş idarəetməsi aktivdir.");
            console.log("Sifariş statusları aktivdir.");
        });

    } catch (error) {
        console.error("Server və ya verilənlər bazası xətası:", error);
        process.exit(1);
    }
}

startServer();
