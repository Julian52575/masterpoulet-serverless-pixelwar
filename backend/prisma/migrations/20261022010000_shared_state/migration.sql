CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "rate_limits" (
    "user_id" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "rate_windows" (
    "user_id" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_windows_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "snapshots" (
    "name" TEXT NOT NULL,
    "png" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("name")
);
