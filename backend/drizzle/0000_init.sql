CREATE TYPE "public"."business_category" AS ENUM('EMPRESAS', 'FESTAS_SERTANEJAS', 'FUTEBOL', 'FEIRAS_CULTURAIS', 'AJUDA_HUMANITARIA');--> statement-breakpoint
CREATE TYPE "public"."business_request_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PAID', 'COMPLETED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."token_status" AS ENUM('ACTIVE', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."token_type" AS ENUM('NATIVE', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."wallet_network" AS ENUM('solana', 'evm');--> statement-breakpoint
CREATE TABLE "business_token_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" varchar(20) NOT NULL,
	"token_name" varchar(40) NOT NULL,
	"symbol" varchar(8) NOT NULL,
	"category" "business_category" NOT NULL,
	"purpose" text NOT NULL,
	"creator_wallet" varchar(100) NOT NULL,
	"creator_wallet_network" "wallet_network" NOT NULL,
	"contact_email" varchar(254),
	"total_supply" numeric(30, 0),
	"status" "business_request_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"utility_class" varchar(40) NOT NULL,
	"terms_version" varchar(20) NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"is_security" boolean DEFAULT false NOT NULL,
	"profit_guarantee" boolean DEFAULT false NOT NULL,
	"compliance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_token_requests_protocol_unique" UNIQUE("protocol")
);
--> statement-breakpoint
CREATE TABLE "p2p_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"source" varchar(30) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_symbol" varchar(10) NOT NULL,
	"fiat_amount" numeric(14, 2) NOT NULL,
	"fee_amount" numeric(14, 2) NOT NULL,
	"unit_price" numeric(24, 8) NOT NULL,
	"token_amount" numeric(30, 8) NOT NULL,
	"user_wallet_address" varchar(100) NOT NULL,
	"wallet_network" "wallet_network" NOT NULL,
	"status" "order_status" DEFAULT 'PENDING' NOT NULL,
	"payment_provider" varchar(40) NOT NULL,
	"payment_txid" varchar(35) NOT NULL,
	"pix_payload" text NOT NULL,
	"payment_reference" varchar(120),
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"custody_tx_hash" varchar(120),
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"idempotency_key" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "p2p_orders_payment_txid_unique" UNIQUE("payment_txid"),
	CONSTRAINT "p2p_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"change_24h" numeric(10, 4) DEFAULT '0' NOT NULL,
	"reference_price_24h" numeric(24, 8) NOT NULL,
	"type" "token_type" NOT NULL,
	"status" "token_status" DEFAULT 'ACTIVE' NOT NULL,
	"decimals" integer DEFAULT 8 NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"description" text,
	"icon_url" text,
	"business_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
ALTER TABLE "p2p_order_events" ADD CONSTRAINT "p2p_order_events_order_id_p2p_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."p2p_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_asset_symbol_tokens_symbol_fk" FOREIGN KEY ("asset_symbol") REFERENCES "public"."tokens"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_requests_symbol_active_uq" ON "business_token_requests" USING btree ("symbol") WHERE "business_token_requests"."status" <> 'REJECTED';--> statement-breakpoint
CREATE INDEX "p2p_order_events_order_idx" ON "p2p_order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "p2p_orders_status_idx" ON "p2p_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "p2p_orders_wallet_idx" ON "p2p_orders" USING btree ("user_wallet_address");