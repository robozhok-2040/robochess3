BEGIN;

UPDATE platform_connections
SET user_id = 'd9d510a0-20fb-4c70-8a57-d984bb97299a'
WHERE platform = 'lichess'
  AND LOWER(platform_username) = 'robozhok';

COMMIT;



