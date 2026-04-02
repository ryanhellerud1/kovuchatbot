import json
import os
from .api_client import BirdeyeClient

class TokenMapper:
    """
    Maps token names/symbols to contract addresses.
    """
    MEMECOIN_MAP_FILE = os.path.join(os.path.dirname(__file__), "memecoin_map.json")

    def __init__(self, birdeye_client: BirdeyeClient):
        """
        Initializes the TokenMapper.

        Args:
            birdeye_client: An instance of BirdeyeClient.
        """
        self.birdeye_client = birdeye_client
        self.local_map = self.load_local_map()

    def load_local_map(self) -> dict:
        """
        Loads the memecoin map from the JSON file.

        Returns:
            A dictionary mapping token names to addresses.
        """
        try:
            with open(self.MEMECOIN_MAP_FILE, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"Warning: Memecoin map file not found at {self.MEMECOIN_MAP_FILE}")
            return {}
        except json.JSONDecodeError:
            print(f"Warning: Error decoding JSON from {self.MEMECOIN_MAP_FILE}")
            return {}

    def get_contract_address(self, token_query: str) -> str | None:
        """
        Gets the contract address for a given token query.

        Args:
            token_query: The token name or symbol to search for.

        Returns:
            The contract address of the token, or None if not found.
        """
        query_lower = token_query.lower()

        # Check local map (case-insensitive keys)
        for name, address in self.local_map.items():
            if name.lower() == query_lower:
                return address

        # If not in local map, search using Birdeye API
        if self.birdeye_client:
            address_from_api = self.birdeye_client.search_token(query_lower, chain="solana")
            if address_from_api:
                # TODO: Consider caching this result dynamically for future lookups
                return address_from_api
        
        return None
