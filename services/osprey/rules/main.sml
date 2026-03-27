Import(rules=['models/base.sml'])

# route to appropriate rules based on action type
Require(rule='rules/copyright/index.sml', require_if=IsCopyrightScan)
Require(rule='rules/images/index.sml', require_if=IsImageScan)
Require(rule='rules/blocklist/index.sml', require_if=IsUserLogin)
