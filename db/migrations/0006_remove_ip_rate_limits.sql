DELETE FROM public_rate_keys WHERE scope IN ('create_ip', 'invalid_link_ip');
ALTER TABLE public_rate_keys DROP CONSTRAINT IF EXISTS public_rate_keys_scope_check;
ALTER TABLE public_rate_keys ADD CONSTRAINT public_rate_keys_scope_check CHECK (scope = 'create_email_shop');
