ALTER TABLE public_rate_keys
  DROP CONSTRAINT public_rate_keys_scope_check,
  ADD CONSTRAINT public_rate_keys_scope_check CHECK (
    scope IN ('create_email_shop', 'create_shop', 'customer_change_link')
  );
