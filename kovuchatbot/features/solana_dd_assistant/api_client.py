import os
import requests

class BirdeyeClient:
    """
    Client for interacting with the Birdeye API.
    """
    BASE_URL = "https://public-api.birdeye.so"

    def __init__(self, api_key: str = None):
        """
        Initializes the BirdeyeClient.

        Args:
            api_key: The Birdeye API key. Defaults to the BIRDEYE_API_KEY
                     environment variable or "YOUR_BIRDEYE_API_KEY" if not set.
                     A real API key is required for actual use.
        """
        self.api_key = api_key or os.environ.get("BIRDEYE_API_KEY", "YOUR_BIRDEYE_API_KEY")
        if self.api_key == "YOUR_BIRDEYE_API_KEY":
            print("Warning: Using a placeholder API key. Please provide a real Birdeye API key for actual use.")

    def _request(self, endpoint: str, params: dict = None) -> dict | None:
        """
        Makes a request to the Birdeye API.

        Args:
            endpoint: The API endpoint path (e.g., "/defi/v3/search").
            params: A dictionary of query parameters.

        Returns:
            The JSON response as a dictionary, or None if an error occurs.
        """
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        
        url = f"{self.BASE_URL}{endpoint}"
        headers = {"X-API-KEY": self.api_key}

        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
            return response.json()
        except requests.exceptions.HTTPError as http_err:
            print(f"HTTP error occurred: {http_err}")
        except requests.exceptions.Timeout as timeout_err:
            print(f"Timeout error occurred: {timeout_err}")
        except requests.exceptions.RequestException as req_err:
            print(f"An error occurred during the request: {req_err}")
        return None

    def search_token(self, query: str, chain: str = "solana") -> str | None:
        """
        Searches for a token on Birdeye.

        Args:
            query: The token name or symbol to search for.
            chain: The blockchain to search on (defaults to "solana").

        Returns:
            The contract address of the token, or None if not found.
        """
        params = {"q": query, "chain": chain}
        response_data = self._request("/defi/v3/search", params=params)

        if response_data and response_data.get("success") and response_data.get("data"):
            items = response_data["data"].get("items")
            if items:
                # Assuming the first result is the most relevant
                return items[0].get("address")
        return None

    def get_token_price(self, contract_address: str, chain: str = "solana") -> dict | None:
        """
        Fetches the price for a given token contract address.

        Args:
            contract_address: The contract address of the token.
            chain: The blockchain to query (defaults to "solana").

        Returns:
            The JSON response containing price data, or None on error.
            Birdeye CU cost: 10
        """
        params = {"address": contract_address, "chain": chain}
        return self._request("/defi/price", params=params)

    def get_token_overview(self, contract_address: str, chain: str = "solana") -> dict | None:
        """
        Fetches overview information for a given token contract address.

        Args:
            contract_address: The contract address of the token.
            chain: The blockchain to query (defaults to "solana").

        Returns:
            The JSON response containing token overview data, or None on error.
            Birdeye CU cost: 30
        """
        params = {"address": contract_address, "chain": chain}
        return self._request("/defi/token_overview", params=params)

    def get_token_security(self, contract_address: str, chain: str = "solana") -> dict | None:
        """
        Fetches security information for a given token contract address.

        Args:
            contract_address: The contract address of the token.
            chain: The blockchain to query (defaults to "solana").

        Returns:
            The JSON response containing token security data, or None on error.
            Birdeye CU cost: 50
        """
        params = {"address": contract_address, "chain": chain}
        return self._request("/defi/token_security", params=params)

    def get_token_holders(self, contract_address: str, chain: str = "solana") -> dict | None:
        """
        Fetches holder information for a given token contract address.

        Args:
            contract_address: The contract address of the token.
            chain: The blockchain to query (defaults to "solana").

        Returns:
            The JSON response containing token holder data, or None on error.
            Birdeye CU cost: 50
        """
        # Note: Birdeye documentation indicates "token_address" for this specific endpoint.
        # However, testing with "address" as per other similar endpoints.
        # If issues arise, this might need to be changed to "token_address".
        params = {"token_address": contract_address, "chain": chain}
        return self._request("/defi/v3/token/holder", params=params)
