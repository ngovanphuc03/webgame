-- Migration 001: Create wallet table
-- Database: meono
-- Description: User wallet for storing balance per guild

CREATE TABLE IF NOT EXISTS `wallet` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `guild_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `balance` BIGINT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY `uk_guild_user` (`guild_id`, `user_id`),
    INDEX `idx_user_id` (`user_id`),
    INDEX `idx_guild_id` (`guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
