from .api_client import BirdeyeClient

class TokenDataService:
    """
    Service to orchestrate calls to Birdeye API for token data.
    """

    def __init__(self, birdeye_client: BirdeyeClient):
        """
        Initializes the TokenDataService.

        Args:
            birdeye_client: An instance of BirdeyeClient.
        """
        self.birdeye_client = birdeye_client

    def get_core_token_info(self, contract_address: str) -> dict | None:
        """
        Fetches and compiles core information for a given token contract address.
        This operation has a combined Birdeye CU cost of 140 
        (10 for price, 30 for overview, 50 for security, 50 for holders).

        Args:
            contract_address: The contract address of the token.

        Returns:
            A dictionary containing compiled token information, 
            or None if critical API calls fail.
        """
        if not self.birdeye_client:
            print("Error: BirdeyeClient not initialized.")
            return None

        # Fetch price and overview data
        price_data = self.birdeye_client.get_token_price(contract_address)
        overview_data = self.birdeye_client.get_token_overview(contract_address)

        # Ensure both API calls were successful and returned data
        if not (price_data and price_data.get("success") and price_data.get("data") and
                overview_data and overview_data.get("success") and overview_data.get("data")):
            print(f"Error: Could not fetch complete data for {contract_address}. Price or overview API call failed.")
            # Optionally, you could return partial data here if one of the calls succeeded
            return None
        
        price_info = price_data["data"]
        overview_info = overview_data["data"]

        # Compile core information
        # Helper to safely get nested dictionary values
        def get_nested(data_dict, *keys, default=None):
            for key in keys:
                if isinstance(data_dict, dict) and key in data_dict:
                    data_dict = data_dict[key]
                else:
                    return default
            return data_dict

        token_info = {
            "name": overview_info.get("name"),
            "symbol": overview_info.get("symbol"),
            "price": price_info.get("value"),
            "logoURI": overview_info.get("logoURI"),
            "website": get_nested(overview_info, "links", "website") or overview_info.get("website"),
            "twitter": get_nested(overview_info, "links", "twitter"),
            "telegram": get_nested(overview_info, "links", "telegram"),
            "marketCap": overview_info.get("mc"), # Market Cap
            "totalSupply": overview_info.get("totalSupply"),
            "circulatingSupply": overview_info.get("circulatingSupply"), # Often not directly available
            "explorerURL": f"https://solscan.io/token/{contract_address}",
            # Add other fields as needed, e.g., from overview_info.extensions
            "extensions": overview_info.get("extensions") 
        }
        
        # Filter out None values if you prefer cleaner output for missing fields
        # token_info = {k: v for k, v in token_info.items() if v is not None}

        # Fetch security and holder data
        security_data_raw = self.birdeye_client.get_token_security(contract_address)
        holder_data_raw = self.birdeye_client.get_token_holders(contract_address)

        # Process security data
        if security_data_raw and security_data_raw.get("success") and security_data_raw.get("data"):
            sec_data = security_data_raw["data"]
            token_info["creatorAddress"] = sec_data.get("creatorAddress")
            token_info["ownerAddress"] = sec_data.get("ownerAddress")
            token_info["isMutable"] = sec_data.get("isMutable")
            # Assuming 'isVerified' might be nested or named differently, adjust if necessary
            # For example, if it's under a 'audit' or 'verification' sub-object
            token_info["isVerified"] = sec_data.get("isVerified") # Placeholder, adjust based on actual API response structure
            token_info["isHoneypot"] = sec_data.get("isHoneypot") # Placeholder
            token_info["lpLock"] = sec_data.get("lpLock") # Placeholder, structure might vary
            token_info["top10HolderPercent"] = sec_data.get("top10HolderPercent") # Often part of security/scan reports
        else:
            print(f"Warning: Could not fetch or process security data for {contract_address}.")

        # Process holder data
        if holder_data_raw and holder_data_raw.get("success") and holder_data_raw.get("data"):
            holders = holder_data_raw["data"].get("holders", [])
            # Summarize top 3-5 holders
            token_info["topHolders"] = [
                {"address": h.get("owner"), "percentage": h.get("percentage")} 
                for h in holders[:5] # Get top 5 holders
            ]
        else:
            print(f"Warning: Could not fetch or process holder data for {contract_address}.")
            
        return token_info
